import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider, theme as antTheme, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useThemeStore } from "@/theme";
import { useI18nStore } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import Layout from "@/components/Layout";
import Login from "@/components/Login";
import ChatPage from "@/pages/Chat";
import SkillsPage from "@/pages/Skills";
import ConfigPage from "@/pages/Config";
import MemoryPage from "@/pages/Memory";
import KnowledgePage from "@/pages/Knowledge";
import AdminPage from "@/pages/Admin";
import FilesPage from "@/pages/Files";
import EvolutionPage from "@/pages/Evolution";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const isDark = useThemeStore((s) => s.theme === 'dark');
  const lang = useI18nStore((s) => s.lang);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return (
    <ConfigProvider
      locale={lang === "zh" ? zhCN : enUS}
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          fontFamily:
            "-apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Layout: {
            headerBg: isDark ? "#141414" : "#fff",
            siderBg: isDark ? "#141414" : "#fff",
          },
          Menu: {
            darkItemBg: "#141414",
          },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="config" element={<ConfigPage />} />
              <Route path="memory" element={<MemoryPage />} />
              <Route path="knowledge" element={<KnowledgePage />} />
              <Route path="files" element={<FilesPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="evolution" element={<EvolutionPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
