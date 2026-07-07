"use client";

import {
  AlertCircle,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  RefreshCw
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth";
import { createDriveApiClient } from "@/features/drive/api/client";
import type { DriveItem, DriveListPayload } from "@/features/drive/types";
import { cn } from "@/lib/utils";

type DriveStatus = "idle" | "loading" | "success" | "error";

const emptyDriveData: DriveListPayload = {
  parent: null,
  breadcrumbs: [],
  items: []
};

const DRIVE_NAME_MAX_LENGTH = 255;

function errorMessageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "파일 목록을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function validateDriveItemName(value: string) {
  const name = value.trim();

  if (!name) {
    return { error: "폴더 이름을 입력해주세요.", name };
  }

  if (name.length > DRIVE_NAME_MAX_LENGTH) {
    return { error: "폴더 이름은 255자 이하로 입력해주세요.", name };
  }

  if (name === "." || name === "..") {
    return { error: "사용할 수 없는 폴더 이름입니다.", name };
  }

  if (/[\\/]/.test(name)) {
    return { error: "폴더 이름에는 / 또는 \\를 사용할 수 없습니다.", name };
  }

  return { error: null, name };
}

function formatFileSize(sizeBytes: number | null) {
  if (sizeBytes === null) {
    return "-";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getItemTypeLabel(item: DriveItem) {
  if (item.itemType === "folder") {
    return "폴더";
  }

  return item.mimeType || "파일";
}

function getItemActorLabel(item: DriveItem) {
  return (
    item.updatedByUser?.name ??
    item.createdByUser?.name ??
    "알 수 없음"
  );
}

function DriveBreadcrumbs({
  breadcrumbs,
  currentParentId,
  onNavigate
}: {
  breadcrumbs: DriveItem[];
  currentParentId: string | null;
  onNavigate: (parentId: string | null) => void;
}) {
  return (
    <nav
      aria-label="파일 경로"
      className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-current={currentParentId === null ? "page" : undefined}
        className="shrink-0"
        onClick={() => onNavigate(null)}
      >
        <Home />
        루트
      </Button>

      {breadcrumbs.map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-current={currentParentId === item.id ? "page" : undefined}
            className="min-w-0"
            onClick={() => onNavigate(item.id)}
          >
            <span className="truncate">{item.name}</span>
          </Button>
        </div>
      ))}
    </nav>
  );
}

function DriveItemRow({
  item,
  onOpenFolder
}: {
  item: DriveItem;
  onOpenFolder: (item: DriveItem) => void;
}) {
  const isFolder = item.itemType === "folder";

  return (
    <li
      className={cn(
        "grid gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(9rem,0.8fr)] md:items-center",
        isFolder && "transition hover:bg-muted/40"
      )}
    >
      {isFolder ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenFolder(item)}
        >
          <DriveItemName item={item} />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-3 text-left">
          <DriveItemName item={item} />
        </div>
      )}

      <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">
        {getItemTypeLabel(item)}
      </span>
      <span className="hidden text-sm text-muted-foreground md:block">
        {formatFileSize(item.sizeBytes)}
      </span>
      <span className="min-w-0 text-xs text-muted-foreground md:text-sm">
        <span className="block truncate">{formatDateTime(item.updatedAt)}</span>
        <span className="block truncate md:hidden">
          {getItemActorLabel(item)}
        </span>
      </span>
    </li>
  );
}

function DriveItemName({ item }: { item: DriveItem }) {
  const isFolder = item.itemType === "folder";

  return (
    <>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            isFolder
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-sky-200 bg-sky-50 text-sky-700"
          )}
        >
          {isFolder ? <Folder className="size-4" /> : <FileText className="size-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{item.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
            {getItemTypeLabel(item)} · {formatFileSize(item.sizeBytes)}
          </span>
        </span>
    </>
  );
}

function DriveListSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid gap-3 border-b px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(9rem,0.8fr)]"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-9" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3 md:hidden" />
            </div>
          </div>
          <Skeleton className="hidden h-4 w-20 md:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

function CreateFolderSheet({
  currentFolderName,
  error,
  isOpen,
  isSubmitting,
  name,
  onNameChange,
  onOpenChange,
  onSubmit
}: {
  currentFolderName: string;
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <SheetHeader>
            <SheetTitle>새 폴더</SheetTitle>
            <SheetDescription>{currentFolderName}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 px-4">
            <label className="grid gap-1.5 text-sm font-medium">
              이름
              <Input
                value={name}
                maxLength={DRIVE_NAME_MAX_LENGTH}
                placeholder="폴더 이름"
                disabled={isSubmitting}
                onChange={(event) => onNameChange(event.currentTarget.value)}
              />
            </label>

            {error ? (
              <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <SheetFooter className="border-t">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FolderPlus />
                )}
                만들기
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function DrivePanel() {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const workspaceName = authSession?.activeWorkspace.name ?? "Workspace";
  const normalizedAccessToken = authSession?.accessToken.trim() ?? "";
  const canUseDrive = Boolean(workspaceId.trim() && normalizedAccessToken);
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [driveData, setDriveData] = useState<DriveListPayload>(emptyDriveData);
  const [status, setStatus] = useState<DriveStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const driveClient = useMemo(
    () => createDriveApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const itemCountLabel = useMemo(() => {
    const folderCount = driveData.items.filter(
      (item) => item.itemType === "folder"
    ).length;
    const fileCount = driveData.items.length - folderCount;

    return `폴더 ${folderCount}개 · 파일 ${fileCount}개`;
  }, [driveData.items]);
  const currentFolderName = driveData.parent
    ? driveData.parent.name
    : `${workspaceName} 루트`;

  const fetchDriveData = useCallback(async () => {
    if (!canUseDrive) {
      return emptyDriveData;
    }

    return driveClient.listItems(workspaceId, {
      parentId: currentParentId
    });
  }, [canUseDrive, currentParentId, driveClient, workspaceId]);

  const reloadDrive = useCallback(async () => {
    if (!canUseDrive) {
      setDriveData(emptyDriveData);
      setStatus("idle");
      setError(null);
      return emptyDriveData;
    }

    setStatus("loading");
    setError(null);

    try {
      const nextDriveData = await fetchDriveData();
      setDriveData(nextDriveData);
      setStatus("success");
      return nextDriveData;
    } catch (loadError) {
      const nextError =
        loadError instanceof Error
          ? loadError
          : new Error("파일 목록을 불러오지 못했습니다.");
      setDriveData(emptyDriveData);
      setError(nextError);
      setStatus("error");
      return emptyDriveData;
    }
  }, [canUseDrive, fetchDriveData]);

  useEffect(() => {
    let active = true;

    async function loadDrive() {
      if (!canUseDrive) {
        setDriveData(emptyDriveData);
        setStatus("idle");
        setError(null);
        return;
      }

      setStatus("loading");
      setError(null);

      try {
        const nextDriveData = await fetchDriveData();
        if (!active) return;

        setDriveData(nextDriveData);
        setStatus("success");
      } catch (loadError) {
        if (!active) return;

        const nextError =
          loadError instanceof Error
            ? loadError
            : new Error("파일 목록을 불러오지 못했습니다.");
        setDriveData(emptyDriveData);
        setError(nextError);
        setStatus("error");
      }
    }

    void loadDrive();

    return () => {
      active = false;
    };
  }, [canUseDrive, fetchDriveData]);

  function openCreateFolderSheet() {
    setFolderName("");
    setFolderError(null);
    setIsCreateOpen(true);
  }

  function handleCreateOpenChange(open: boolean) {
    if (isCreatingFolder) {
      return;
    }

    setIsCreateOpen(open);

    if (!open) {
      setFolderName("");
      setFolderError(null);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canUseDrive) {
      setFolderError("폴더를 만들려면 로그인이 필요합니다.");
      return;
    }

    const result = validateDriveItemName(folderName);
    if (result.error) {
      setFolderError(result.error);
      return;
    }

    setIsCreatingFolder(true);
    setFolderError(null);

    try {
      await driveClient.createFolder(workspaceId, {
        parentId: currentParentId,
        name: result.name
      });
      setIsCreateOpen(false);
      setFolderName("");
      await reloadDrive();
    } catch (createError) {
      setFolderError(errorMessageFromUnknown(createError));
    } finally {
      setIsCreatingFolder(false);
    }
  }

  const isLoading = status === "loading";
  const isEmpty = status === "success" && driveData.items.length === 0;

  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] flex-col gap-4">
      <section className="flex flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold leading-tight">
              파일
            </h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {currentFolderName} · {itemCountLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseDrive || isLoading}
              onClick={() => void reloadDrive()}
            >
              {isLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              새로고침
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canUseDrive}
              onClick={openCreateFolderSheet}
            >
              <FolderPlus />
              새 폴더
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-background">
          <div className="flex min-h-12 items-center px-3">
            <DriveBreadcrumbs
              breadcrumbs={driveData.breadcrumbs}
              currentParentId={currentParentId}
              onNavigate={setCurrentParentId}
            />
          </div>
          <Separator />

          {status === "error" ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
                <AlertCircle className="size-5" />
              </span>
              <div className="max-w-sm">
                <h2 className="font-heading text-base font-semibold">
                  파일 목록을 불러오지 못했습니다
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {error?.message ?? "잠시 후 다시 시도해주세요."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canUseDrive || isLoading}
                onClick={() => void reloadDrive()}
              >
                <RefreshCw />
                다시 시도
              </Button>
            </div>
          ) : isLoading ? (
            <DriveListSkeleton />
          ) : isEmpty ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground">
                <Folder className="size-5" />
              </span>
              <div>
                <h2 className="font-heading text-base font-semibold">
                  비어 있습니다
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  이 위치에는 아직 파일이나 폴더가 없습니다.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!canUseDrive}
                onClick={openCreateFolderSheet}
              >
                <FolderPlus />
                새 폴더
              </Button>
            </div>
          ) : (
            <div className="min-h-0 overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid border-b bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(9rem,0.8fr)]">
                  <span>이름</span>
                  <span>유형</span>
                  <span>크기</span>
                  <span>수정일</span>
                </div>
                <ul>
                  {driveData.items.map((item) => (
                    <DriveItemRow
                      key={item.id}
                      item={item}
                      onOpenFolder={(folder) => setCurrentParentId(folder.id)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>

      <CreateFolderSheet
        currentFolderName={currentFolderName}
        error={folderError}
        isOpen={isCreateOpen}
        isSubmitting={isCreatingFolder}
        name={folderName}
        onNameChange={setFolderName}
        onOpenChange={handleCreateOpenChange}
        onSubmit={handleCreateFolder}
      />
    </div>
  );
}
