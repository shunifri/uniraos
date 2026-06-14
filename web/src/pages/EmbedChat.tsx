import { useEffect, useState } from "react";
import { ConfigProvider, theme as antTheme, App as AntApp, Spin, Button } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useAuthStore } from "@/store/auth";
import Login from "@/components/Login";
import ChatPage from "@/pages/Chat";
import { api } from "@/api";

/** 嵌入版聊天页面
 *  通过 postMessage 或 URL 参数接收 token，用于第三方 iframe 嵌入场景。
 *  未提供 token 时显示登录界面，登录成功后自动进入对话。
 */
export default function EmbedChat() {
  const [ready, setReady] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [defaultSkill, setDefaultSkill] = useState<string | undefined>(undefined);
  const [defaultSkills, setDefaultSkills] = useState<string[] | undefined>(undefined);
  const [appId, setAppId] = useState<string | undefined>(undefined);
  const [embedTitle, setEmbedTitle] = useState<string>("RAOS 智能助手");
  const [embedIcon, setEmbedIcon] = useState<string>("");

  useEffect(() => {
    // 1. 尝试从 URL 参数获取 token、role、skill、app、title、icon
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");
    const roleFromUrl = params.get("role");
    const skillFromUrl = params.get("skill");
    const appFromUrl = params.get("app");
    const titleFromUrl = params.get("title");
    const iconFromUrl = params.get("icon");

    if (titleFromUrl) setEmbedTitle(titleFromUrl);
    if (iconFromUrl) setEmbedIcon(iconFromUrl);

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

    const extraSkills: string[] = skillFromUrl ? [skillFromUrl] : [];

    const applyToken = async (token: string) => {
      useAuthStore.setState({ token });
      try {
        await useAuthStore.getState().checkSession();
        // token 就绪后再加载 skills，确保 /api/apps/:appId 能带认证调用
        await loadSkills(appFromUrl, extraSkills);
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
    // 必须验证 origin，防止恶意页面伪造消息
    const expectedOrigin = window.location.origin;
    let resolved = false;
    const handler = (e: MessageEvent) => {
      if (e.origin !== expectedOrigin) return;
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
      // 清理 embeddedRole，避免影响同页面后续导航
      useAuthStore.setState({ embeddedRole: undefined });
      // 如果当前是访客身份，清除 token 避免污染主站登录状态
      //（嵌入场景获取的访客 token 不应持久化到 localStorage）
      if (useAuthStore.getState().isAnonymous) {
        useAuthStore.getState().logout();
      }
    };
  }, []);

  const loadSkills = async (appId: string | null, extraSkills: string[]) => {
    try {
      // 并行加载 anonymous 基础 skills 和 app skills
      const [anonRes, appRes] = await Promise.all([
        api.get<any>("/api/permissions/anonymous-skills").catch(() => null),
        appId ? api.get<any>(`/api/apps/${appId}`).catch(() => null) : null,
      ]);

      const anonSkills: string[] = anonRes?.success ? anonRes.data?.skills ?? [] : [];
      const appData = appRes?.success ? appRes.data : null;
      const appSkills: string[] = appData
        ? appData.skills?.map((s: { key: string }) => s.key) ?? []
        : [];

      // 合并去重：anonymous 基础 skills + app skills + 额外传入的 skill
      const merged = Array.from(new Set([...anonSkills, ...appSkills, ...extraSkills]));

      if (merged.length > 0) {
        setDefaultSkills(merged);
        // 单 skill 场景同时设置 defaultSkill，兼容后端单 skill 语义
        if (merged.length === 1) {
          setDefaultSkill(merged[0]);
        }
      }

      // 记住 appId，让后端自己加载应用设定（避免前端传递 systemPrompt 被篡改）
      if (appId) {
        setAppId(appId);
      }

      // iframe 模式未传 title 时，自动使用应用名称作为标题
      const params = new URLSearchParams(window.location.search);
      if (appData && !params.get("title")) {
        setEmbedTitle(appData.name || "RAOS 智能助手");
      }
    } catch {
      // 加载 skills 失败，静默处理，让对话正常进行
    }
  };

  const handleLoginSuccess = async () => {
    setShowLogin(false);
    // 手动登录成功后重新加载 skills（URL 参数中可能带有 app/skill）
    const params = new URLSearchParams(window.location.search);
    const skillFromUrl = params.get("skill");
    const appFromUrl = params.get("app");
    const extraSkills: string[] = skillFromUrl ? [skillFromUrl] : [];
    await loadSkills(appFromUrl, extraSkills);
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
                {embedIcon ? (
                  <img
                    src={embedIcon}
                    alt=""
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      marginBottom: 12,
                      display: "inline-block",
                      boxShadow: "0 4px 16px rgba(139, 92, 246, 0.25)",
                      objectFit: "cover",
                    }}
                  />
                ) : null}
                <div>{embedTitle}</div>
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
          <ChatPage embedded defaultSkill={defaultSkill} defaultSkills={defaultSkills} appId={appId} title={embedTitle} icon={embedIcon} />
        </div>
      </AntApp>
    </ConfigProvider>
  );
}
