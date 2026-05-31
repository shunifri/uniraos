import { useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider, theme as antTheme, App as AntApp, Spin } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useThemeStore, getThemeConfig } from "@/theme";
import { useI18nStore } from "@/i18n";
import { useAuthStore } from "@/store/auth";
import Layout from "@/components/Layout";
import Login from "@/components/Login";
import ChatPage from "@/pages/Chat";
import EmbedChat from "@/pages/EmbedChat";

// P2 修复：路由懒加载，减少首屏 bundle
const SkillsPage = lazy(() => import("@/pages/Skills"));
const ConfigPage = lazy(() => import("@/pages/Config"));
const MemoryPage = lazy(() => import("@/pages/Memory"));
const KnowledgePage = lazy(() => import("@/pages/Knowledge"));
const KnowledgeGraphPage = lazy(() => import("@/pages/KnowledgeGraph"));
const AdminPage = lazy(() => import("@/pages/Admin"));
const FilesPage = lazy(() => import("@/pages/Files"));
const EvolutionPage = lazy(() => import("@/pages/Evolution"));
const FederationPage = lazy(() => import("@/pages/Federation"));
const ConnectionsPage = lazy(() => import("@/pages/Connections"));
const ApprovalsPage = lazy(() => import("@/pages/Approvals"));
const WorkflowTaskPage = lazy(() => import("@/pages/WorkflowTaskPage"));
const WorkflowsPage = lazy(() => import("@/pages/WorkflowsPage"));
const FormsPage = lazy(() => import("@/pages/FormsPage"));
const FormDesignerPage = lazy(() => import("@/pages/FormDesigner"));
const WorkflowDesignerPage = lazy(() => import("@/pages/WorkflowDesigner"));
const AppsPage = lazy(() => import("@/pages/AppsPage"));

function LazyFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <Spin size="large" />
    </div>
  );
}

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
        ...getThemeConfig(isDark ? 'dark' : 'light'),
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
              <Route path="skills" element={<Suspense fallback={<LazyFallback />}><SkillsPage /></Suspense>} />
              <Route path="config" element={<Suspense fallback={<LazyFallback />}><ConfigPage /></Suspense>} />
              <Route path="memory" element={<Suspense fallback={<LazyFallback />}><MemoryPage /></Suspense>} />
              <Route path="knowledge" element={<Suspense fallback={<LazyFallback />}><KnowledgePage /></Suspense>} />
              <Route path="knowledge-graph" element={<Suspense fallback={<LazyFallback />}><KnowledgeGraphPage /></Suspense>} />
              <Route path="files" element={<Suspense fallback={<LazyFallback />}><FilesPage /></Suspense>} />
              <Route path="admin" element={<Suspense fallback={<LazyFallback />}><AdminPage /></Suspense>} />
              <Route path="evolution" element={<Suspense fallback={<LazyFallback />}><EvolutionPage /></Suspense>} />
              <Route path="federation" element={<Suspense fallback={<LazyFallback />}><FederationPage /></Suspense>} />
              <Route path="connections" element={<Suspense fallback={<LazyFallback />}><ConnectionsPage /></Suspense>} />
              <Route path="approvals" element={<Suspense fallback={<LazyFallback />}><ApprovalsPage /></Suspense>} />
              <Route path="workflow/tasks/:id" element={<Suspense fallback={<LazyFallback />}><WorkflowTaskPage /></Suspense>} />
              <Route path="workflows" element={<Suspense fallback={<LazyFallback />}><WorkflowsPage /></Suspense>} />
              <Route path="forms" element={<Suspense fallback={<LazyFallback />}><FormsPage /></Suspense>} />
              <Route path="forms/designer" element={<Suspense fallback={<LazyFallback />}><FormDesignerPage /></Suspense>} />
              <Route path="forms/designer/:id" element={<Suspense fallback={<LazyFallback />}><FormDesignerPage /></Suspense>} />
              <Route path="workflow/designer" element={<Suspense fallback={<LazyFallback />}><WorkflowDesignerPage /></Suspense>} />
              <Route path="workflow/designer/:key" element={<Suspense fallback={<LazyFallback />}><WorkflowDesignerPage /></Suspense>} />
              <Route path="apps" element={<Suspense fallback={<LazyFallback />}><AppsPage /></Suspense>} />
            </Route>
            <Route path="/embed" element={<EmbedChat />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
