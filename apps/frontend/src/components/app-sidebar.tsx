"use client";

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  ChevronRight,
  GalleryVerticalEnd,
  LogOut,
  Plus,
  Sparkles,
  UserRound
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar
} from "@/components/ui/sidebar";
import type { FeatureNavigationItem } from "@/features/navigation-types";
import { cn } from "@/lib/utils";

export type AppSidebarItem = Pick<
  FeatureNavigationItem,
  "description" | "href" | "icon" | "id" | "items" | "title"
>;

type AppSidebarProps = {
  items: AppSidebarItem[];
  selectedItemId: string;
  onSelectItem?: (itemId: string) => void;
};

const workspaces = [
  {
    name: "PILO",
    description: "AI Project OS",
    icon: GalleryVerticalEnd
  },
  {
    name: "Frontend",
    description: "Main page sprint",
    icon: Sparkles
  },
  {
    name: "Review Lab",
    description: "PR review flow",
    icon: BadgeCheck
  }
];

const currentUser = {
  name: "동현",
  email: "donghyun@pilo.local",
  initials: "DH"
};

export function AppSidebar({
  items,
  selectedItemId,
  onSelectItem
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();
  const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState(0);
  const [activeSubItemHref, setActiveSubItemHref] = useState<
    string | undefined
  >(items[0]?.href);
  const [openMenuIds, setOpenMenuIds] = useState<Record<string, boolean>>({
    [selectedItemId]: true
  });
  const activeWorkspace = workspaces[activeWorkspaceIndex] ?? workspaces[0];
  const selectedItem = items.find((item) => item.id === selectedItemId);

  useEffect(() => {
    setOpenMenuIds((currentOpenMenuIds) => ({
      ...currentOpenMenuIds,
      [selectedItemId]: true
    }));
    setActiveSubItemHref(selectedItem?.href);
  }, [selectedItem?.href, selectedItemId]);

  const handleSelectItem = (
    itemId: string,
    href: string,
    options: { closeMobile?: boolean } = {}
  ) => {
    onSelectItem?.(itemId);
    setActiveSubItemHref(href);
    router.push(href);

    if (isMobile && options.closeMobile !== false) {
      setOpenMobile(false);
    }
  };

  const handleSelectSubItem = (
    itemId: string,
    href: string,
    event: MouseEvent<HTMLAnchorElement>
  ) => {
    event.preventDefault();
    handleSelectItem(itemId, href);
  };

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <activeWorkspace.icon className="size-5!" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {activeWorkspace.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {activeWorkspace.description}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-56 rounded-lg"
                side="bottom"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>워크스페이스</DropdownMenuLabel>
                  {workspaces.map((workspace, index) => (
                    <DropdownMenuItem
                      className="gap-2 p-2"
                      key={workspace.name}
                      onClick={() => setActiveWorkspaceIndex(index)}
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                        <workspace.icon className="size-3.5" />
                      </div>
                      <div className="grid flex-1 leading-tight">
                        <span className="font-medium">{workspace.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {workspace.description}
                        </span>
                      </div>
                      <DropdownMenuShortcut>
                        Alt+{index + 1}
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="gap-2 p-2">
                    <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                      <Plus className="size-3.5" />
                    </div>
                    <span className="font-medium">워크스페이스 추가</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>주요 기능</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive = selectedItemId === item.id;
                const isOpen = openMenuIds[item.id] ?? false;

                return (
                  <SidebarMenuItem key={item.id}>
                    <Collapsible
                      className="group/collapsible"
                      onOpenChange={(open) =>
                        setOpenMenuIds((currentOpenMenuIds) => ({
                          ...currentOpenMenuIds,
                          [item.id]: open
                        }))
                      }
                      open={isOpen}
                    >
                      <CollapsibleTrigger
                        onClick={() => handleSelectItem(item.id, item.href)}
                        render={
                          <SidebarMenuButton
                            aria-current={isActive ? "page" : undefined}
                            className="transition-colors data-[active=true]:shadow-sm"
                            isActive={isActive}
                            size="lg"
                            tooltip={item.title}
                          />
                        }
                      >
                        <item.icon />
                        <div className="grid flex-1 text-left leading-tight">
                          <span className="truncate">{item.title}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        </div>
                        <ChevronRight
                          className={cn(
                            "ml-auto size-4 transition-transform",
                            isOpen && "rotate-90"
                          )}
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items?.map((subItem) => (
                            <SidebarMenuSubItem key={subItem.href}>
                              <SidebarMenuSubButton
                                href={subItem.href}
                                isActive={activeSubItemHref === subItem.href}
                                onClick={(event) =>
                                  handleSelectSubItem(
                                    item.id,
                                    subItem.href,
                                    event
                                  )
                                }
                              >
                                <span>{subItem.title}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </Collapsible>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar size="sm">
                  <AvatarFallback>{currentUser.initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {currentUser.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {currentUser.email}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar>
                        <AvatarFallback>{currentUser.initials}</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 leading-tight">
                        <span className="font-medium">{currentUser.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {currentUser.email}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="gap-2">
                    <BadgeCheck />
                    계정
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <Bell />
                    알림
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <UserRound />
                    프로필
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="gap-2">
                    <LogOut />
                    로그아웃
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
