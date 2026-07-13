export type SettingsSectionId =
  | "general"
  | "appearance"
  | "github"
  | "workspace";

export const MOCK_PROFILE = {
  jobTitle: "Product Engineer",
  bio: "PILO에서 팀의 개발 흐름과 AI 협업 경험을 설계하고 있습니다.",
  provider: "GitHub",
  joinedAt: "2026. 6. 12."
};

export const MOCK_ACCOUNT_FORM = {
  jobTitle: MOCK_PROFILE.jobTitle,
  bio: MOCK_PROFILE.bio,
  avatarMode: "provider" as "provider" | "custom" | "initials",
  customAvatarUrl: "",
  avatarColor: "violet"
};

export const MOCK_SETTINGS_FORM = {
  defaultWorkspace: "active",
  defaultLandingPage: "home",
  restoreLastWorkspace: true,
  theme: "system",
  density: "comfortable"
};

export const AVATAR_COLORS = [
  { id: "violet", label: "보라색", className: "bg-violet-500" },
  { id: "blue", label: "파란색", className: "bg-blue-500" },
  { id: "emerald", label: "초록색", className: "bg-emerald-500" },
  { id: "orange", label: "주황색", className: "bg-orange-500" }
];
