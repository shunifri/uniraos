import { create } from 'zustand';

interface MobileState {
  isMobile: boolean;
  sidebarOpen: boolean;
  checkMobile: () => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
}

export const useMobileStore = create<MobileState>((set) => ({
  isMobile: window.innerWidth < 768,
  sidebarOpen: false,
  checkMobile: () => set({ isMobile: window.innerWidth < 768 }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
}));
