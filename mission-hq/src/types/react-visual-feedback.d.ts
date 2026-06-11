declare module "react-visual-feedback" {
  import type { ComponentType, ReactNode } from "react";

  export interface FeedbackData {
    feedback?: string;
    screenshot?: string;
    video?: string;
    attachment?: File | null;
    eventLogs?: unknown;
    elementInfo?: unknown;
    [key: string]: unknown;
  }

  export interface FeedbackProviderProps {
    onSubmit: (data: FeedbackData) => void | Promise<void>;
    onStatusChange?: (args: { id: string; status: string; comment?: string }) => void;
    dashboard?: boolean;
    dashboardData?: unknown[];
    isDeveloper?: boolean;
    isUser?: boolean;
    userName?: string;
    userEmail?: string | null;
    userAvatar?: string | null;
    mode?: "light" | "dark";
    isActive?: boolean;
    onActiveChange?: (active: boolean) => void;
    defaultOpen?: boolean;
    showFeedbackDots?: boolean;
    feedbackDotsData?: unknown[] | null;
    children?: ReactNode;
  }

  export const FeedbackProvider: ComponentType<FeedbackProviderProps>;

  export function useFeedback(): {
    isActive: boolean;
    setIsActive: (v: boolean) => void;
    setIsDashboardOpen: (v: boolean) => void;
    startRecording: () => void;
  };
}
