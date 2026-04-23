/**
 * RAOS Chat Widget — 第三方页面嵌入脚本
 *
 * 用法：
 * <script src="https://your-raos-domain.com/widget.js"
 *   data-position="bottom-right"
 *   data-bottom="20"
 *   data-right="20"
 *   data-token="jwt-token"
 *   data-title="智能助手"
 * ></script>
 *
 * 配置项（通过 data-* 属性）：
 *   data-position   — 初始方位: bottom-right | bottom-left | top-right | top-left (默认 bottom-right)
 *   data-bottom     — 距离底部 px (默认 20)
 *   data-right      — 距离右侧 px (默认 20，position 含 right 时生效)
 *   data-left       — 距离左侧 px (默认 20，position 含 left 时生效)
 *   data-top        — 距离顶部 px (默认 20，position 含 top 时生效)
 *   data-token      — JWT 认证令牌（可选，跨域场景需要）
 *   data-base-url   — RAOS 服务地址（默认从脚本地址自动推断）
 *   data-title      — 窗口标题（默认 "RAOS 智能助手"）
 *   data-width      — 弹窗宽度 px（默认 420）
 *   data-height     — 弹窗高度 px（默认 640）
 *   data-z-index    — 层级（默认 999999）
 *   data-role       — 角色标识，对应后端角色配置（如 presales, support）
 */
(function () {
  "use strict";

  // --- 配置解析 ---
  const currentScript = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!currentScript) {
    console.error("[RAOS Widget] 未找到当前 script 标签");
    return;
  }

  const ds = currentScript.dataset;
  const scriptSrc = currentScript.src || "";
  const inferredBase = scriptSrc.replace(/\/widget\.js$/, "") || "";

  const config = {
    position: ds.position || "bottom-right",
    bottom: parseInt(ds.bottom, 10) || 20,
    right: parseInt(ds.right, 10) || 20,
    left: parseInt(ds.left, 10) || 20,
    top: parseInt(ds.top, 10) || 20,
    token: ds.token || "",
    baseUrl: (ds.baseUrl || inferredBase).replace(/\/$/, ""),
    title: ds.title || "RAOS 智能助手",
    width: parseInt(ds.width, 10) || 420,
    height: parseInt(ds.height, 10) || 640,
    zIndex: parseInt(ds.zIndex, 10) || 999999,
    role: ds.role || "",
  };

  if (!config.baseUrl) {
    console.error("[RAOS Widget] 无法推断 baseUrl，请显式设置 data-base-url");
    return;
  }

  // --- 状态 ---
  let isOpen = false;
  let iframe = null;
  let container = null;
  let toggleBtn = null;
  let dragState = null;
  const storageKey = "raos-widget-pos";

  // --- 读取/保存拖拽位置 ---
  function loadSavedPos() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }

  function savePos(pos) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {}
  }

  // --- 创建样式 ---
  const styleId = "raos-widget-style";
  if (!document.getElementById(styleId)) {
    const css = document.createElement("style");
    css.id = styleId;
    css.textContent = `
      #raos-widget-btn {
        position: fixed;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        z-index: ${config.zIndex};
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      #raos-widget-btn:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 24px rgba(102, 126, 234, 0.45);
      }
      #raos-widget-btn:active {
        transform: scale(0.96);
      }
      #raos-widget-container {
        position: fixed;
        display: none;
        flex-direction: column;
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
        overflow: hidden;
        z-index: ${config.zIndex};
        border: 1px solid rgba(0,0,0,0.06);
      }
      #raos-widget-container.open {
        display: flex;
      }
      #raos-widget-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        flex-shrink: 0;
        cursor: default;
      }
      #raos-widget-header-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #raos-widget-close {
        background: rgba(255,255,255,0.15);
        border: none;
        color: #fff;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        line-height: 1;
        padding: 0;
        transition: background 0.2s;
      }
      #raos-widget-close:hover {
        background: rgba(255,255,255,0.3);
      }
      #raos-widget-iframe {
        flex: 1;
        width: 100%;
        border: none;
        display: block;
      }
      @media (max-width: 480px) {
        #raos-widget-container {
          width: 100vw !important;
          height: 100vh !important;
          top: 0 !important;
          left: 0 !important;
          right: auto !important;
          bottom: auto !important;
          border-radius: 0 !important;
        }
      }
    `;
    document.head.appendChild(css);
  }

  // --- 计算按钮初始位置 ---
  // 优先级：显式 data-left/data-right/data-top/data-bottom > data-position 推断
  function computeInitialPos() {
    const saved = loadSavedPos();
    if (saved) return saved;

    const pos = {};
    const hasExplicitH = ds.left !== undefined || ds.right !== undefined;
    const hasExplicitV = ds.top !== undefined || ds.bottom !== undefined;

    // 水平方向
    if (hasExplicitH) {
      if (ds.left !== undefined) pos.left = config.left + "px";
      if (ds.right !== undefined) pos.right = config.right + "px";
    } else {
      if (config.position.includes("right")) pos.right = config.right + "px";
      if (config.position.includes("left")) pos.left = config.left + "px";
    }

    // 垂直方向
    if (hasExplicitV) {
      if (ds.top !== undefined) pos.top = config.top + "px";
      if (ds.bottom !== undefined) pos.bottom = config.bottom + "px";
    } else {
      if (config.position.includes("bottom")) pos.bottom = config.bottom + "px";
      if (config.position.includes("top")) pos.top = config.top + "px";
    }

    return pos;
  }

  // --- 计算弹窗位置 ---
  function computeWindowPos() {
    const pos = { width: config.width + "px", height: config.height + "px" };
    const hasExplicitH = ds.left !== undefined || ds.right !== undefined;
    const hasExplicitV = ds.top !== undefined || ds.bottom !== undefined;

    // 水平方向
    if (hasExplicitH) {
      if (ds.left !== undefined) pos.left = config.left + "px";
      if (ds.right !== undefined) pos.right = config.right + "px";
    } else {
      if (config.position.includes("right")) pos.right = config.right + "px";
      if (config.position.includes("left")) pos.left = config.left + "px";
    }

    // 垂直方向：弹窗在按钮上方或下方
    if (hasExplicitV) {
      if (ds.top !== undefined) pos.top = (config.top + 68) + "px";
      if (ds.bottom !== undefined) pos.bottom = (config.bottom + 68) + "px";
    } else {
      if (config.position.includes("bottom")) pos.bottom = (config.bottom + 68) + "px";
      if (config.position.includes("top")) pos.top = (config.top + 68) + "px";
    }

    return pos;
  }

  // --- 创建按钮 ---
  function createButton() {
    const btn = document.createElement("button");
    btn.id = "raos-widget-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", config.title);
    btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

    const pos = computeInitialPos();
    Object.assign(btn.style, pos);

    document.body.appendChild(btn);
    return btn;
  }

  // --- 创建弹窗 ---
  function createContainer() {
    const el = document.createElement("div");
    el.id = "raos-widget-container";

    const pos = computeWindowPos();
    Object.assign(el.style, pos);

    const header = document.createElement("div");
    header.id = "raos-widget-header";
    header.innerHTML = `
      <div id="raos-widget-header-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span>${escapeHtml(config.title)}</span>
      </div>
    `;

    const closeBtn = document.createElement("button");
    closeBtn.id = "raos-widget-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWidget();
    });
    header.appendChild(closeBtn);

    iframe = document.createElement("iframe");
    iframe.id = "raos-widget-iframe";
    const queryParams = new URLSearchParams();
    if (config.token) queryParams.set("token", config.token);
    if (config.role) queryParams.set("role", config.role);
    const queryString = queryParams.toString();
    iframe.src = `${config.baseUrl}/embed${queryString ? "?" + queryString : ""}`;
    iframe.title = config.title;
    iframe.allow = "clipboard-write; fullscreen";

    el.appendChild(header);
    el.appendChild(iframe);
    document.body.appendChild(el);

    return el;
  }

  // --- 打开 / 关闭 ---
  function openWidget() {
    if (!container) container = createContainer();
    container.classList.add("open");
    isOpen = true;
    toggleBtn.style.display = "none";

    // 如果 token 是通过 postMessage 传递的（跨域且不在 URL 中），在 iframe 加载完成后发送
    if (config.token && iframe.contentWindow) {
      const sendToken = () => {
        iframe.contentWindow.postMessage(
          { type: "RAOS_AUTH", token: config.token },
          config.baseUrl
        );
      };
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
        sendToken();
      } else {
        iframe.addEventListener("load", sendToken, { once: true });
      }
    }
  }

  function closeWidget() {
    if (container) container.classList.remove("open");
    isOpen = false;
    toggleBtn.style.display = "flex";
  }

  function toggleWidget() {
    if (isOpen) closeWidget();
    else openWidget();
  }

  // --- 拖拽 ---
  function initDrag() {
    const onStart = (e) => {
      const isTouch = e.type === "touchstart";
      const point = isTouch ? e.touches[0] : e;
      const rect = toggleBtn.getBoundingClientRect();

      dragState = {
        startX: point.clientX,
        startY: point.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        isTouch,
      };

      toggleBtn.style.transition = "none";
      document.addEventListener(isTouch ? "touchmove" : "mousemove", onMove, { passive: false });
      document.addEventListener(isTouch ? "touchend" : "mouseup", onEnd, { once: true });
    };

    const onMove = (e) => {
      if (!dragState) return;
      e.preventDefault();
      const point = dragState.isTouch ? e.touches[0] : e;
      const dx = point.clientX - dragState.startX;
      const dy = point.clientY - dragState.startY;

      let left = dragState.startLeft + dx;
      let top = dragState.startTop + dy;

      // 限制在视口内
      const maxLeft = window.innerWidth - toggleBtn.offsetWidth;
      const maxTop = window.innerHeight - toggleBtn.offsetHeight;
      left = Math.max(0, Math.min(left, maxLeft));
      top = Math.max(0, Math.min(top, maxTop));

      toggleBtn.style.left = left + "px";
      toggleBtn.style.top = top + "px";
      toggleBtn.style.right = "auto";
      toggleBtn.style.bottom = "auto";
    };

    const onEnd = () => {
      if (!dragState) return;
      document.removeEventListener(dragState.isTouch ? "touchmove" : "mousemove", onMove);
      toggleBtn.style.transition = "transform 0.2s ease, box-shadow 0.2s ease";

      // 保存位置
      const rect = toggleBtn.getBoundingClientRect();
      savePos({ left: rect.left + "px", top: rect.top + "px", right: "auto", bottom: "auto" });

      dragState = null;
    };

    toggleBtn.addEventListener("mousedown", onStart);
    toggleBtn.addEventListener("touchstart", onStart, { passive: false });

    // 点击（非拖拽）打开窗口
    let clickStartTime = 0;
    toggleBtn.addEventListener("mousedown", () => { clickStartTime = Date.now(); });
    toggleBtn.addEventListener("touchstart", () => { clickStartTime = Date.now(); });

    const onClick = (e) => {
      // 如果拖拽了，不触发点击
      if (dragState) return;
      const duration = Date.now() - clickStartTime;
      if (duration < 300) toggleWidget();
    };
    toggleBtn.addEventListener("click", onClick);
    toggleBtn.addEventListener("touchend", onClick);
  }

  // --- 工具函数 ---
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- 初始化 ---
  function init() {
    if (document.getElementById("raos-widget-btn")) return; // 防止重复加载
    toggleBtn = createButton();
    initDrag();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
