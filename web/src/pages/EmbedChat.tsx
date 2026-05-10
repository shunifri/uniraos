import { useEffect, useState } from "react";
import { ConfigProvider, theme as antTheme, App as AntApp, Spin, Button } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useAuthStore } from "@/store/auth";
import Login from "@/components/Login";
import ChatPage from "@/pages/Chat";

/** 嵌入版聊天页面
 *  通过 postMessage 或 URL 参数接收 token，用于第三方 iframe 嵌入场景。
 *  未提供 token 时显示登录界面，登录成功后自动进入对话。
 */
export default function EmbedChat() {
  const [ready, setReady] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    // 1. 尝试从 URL 参数获取 token、role 和 skill
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");
    const roleFromUrl = params.get("role");
    const skillFromUrl = params.get("skill");
    if (roleFromUrl) {
      useAuthStore.setState({ embeddedRole: roleFromUrl });
    }

    // 2. 尝试从 localStorage 获取（同域场景）
    const persisted = localStorage.getItem("raos-auth");
    let tokenFromStorage: string | null = null;
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted);
        tokenFromStorage = parsed?.state?.token ?? null;
      } catch {
        // ignore
      }
    }

    const applyToken = async (token: string) => {
      useAuthStore.setState({ token });
      try {
        await useAuthStore.getState().checkSession();
        setReady(true);
      } catch {
        // token 过期或无效，清除后显示登录
        useAuthStore.getState().logout();
        setShowLogin(true);
      }
    };

    if (tokenFromUrl) {
      applyToken(tokenFromUrl);
      return;
    }

    if (tokenFromStorage) {
      applyToken(tokenFromStorage);
      return;
    }

    // 3. 等待 postMessage 注入 token（跨域 iframe 场景）
    let resolved = false;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "RAOS_AUTH" && e.data?.token && !resolved) {
        resolved = true;
        applyToken(e.data.token);
      }
    };
    window.addEventListener("message", handler);

    // 4. 短延时后若仍无 token，自动获取访客身份（无需登录）
    const timer = setTimeout(async () => {
      if (!resolved && !useAuthStore.getState().token) {
        try {
          const res = await fetch("/api/auth/visitor", { method: "POST" });
          const data = await res.json();
          if (data.success && data.token) {
            resolved = true;
            applyToken(data.token);
            return;
          }
        } catch {
          // 访客登录失败，回退到普通登录界面
        }
        setShowLogin(true);
      }
    }, 1500);

    return () => {
      window.removeEventListener("message", handler);
      clearTimeout(timer);
    };
  }, []);

  const handleLoginSuccess = () => {
    setShowLogin(false);
    setReady(true);
  };

  if (showLogin && !ready) {
    return (
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: antTheme.defaultAlgorithm,
          token: {
            colorPrimary: "#1677ff",
            borderRadius: 8,
            fontFamily:
              "-apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          },
        }}
      >
        <AntApp>
          <div
            style={{
              width: "100%",
              height: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%)",
              padding: 20,
            }}
          >
            <div style={{ width: "100%", maxWidth: 400 }}>
              <div
                style={{
                  textAlign: "center",
                  marginBottom: 24,
                  fontSize: 20,
                  fontWeight: 600,
                  color: "#333",
                }}
              >
                <img
                  src="/ai-avatar.png"
                  alt="AI"
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    marginBottom: 12,
                    display: "inline-block",
                    boxShadow: "0 4px 16px rgba(139, 92, 246, 0.25)",
                  }}
                />
                <div>RAOS 智能助手</div>
              </div>
              <Login onSuccess={handleLoginSuccess} />
            </div>
          </div>
        </AntApp>
      </ConfigProvider>
    );
  }

  if (!ready) {
    return (
      <div
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
        }}
      >
        <Spin />
      </div>
    );
  }

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: antTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          fontFamily:
            "-apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Layout: {
            headerBg: "#fff",
            siderBg: "#fff",
          },
        },
      }}
    >
      <AntApp>
        <div
          style={{
            width: "100%",
            height: "100vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ChatPage embedded defaultSkill={skillFromUrl || undefined} />
        </div>
      </AntApp>
    </ConfigProvider>
  );
}
