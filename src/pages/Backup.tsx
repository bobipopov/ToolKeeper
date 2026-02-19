import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DatabaseBackup,
  Download,
  Upload,
  Cloud,
  Trash2,
  RotateCcw,
  Clock,
  Calendar,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ─── Types ───────────────────────────────────────────────────
type BackupSchedule = {
  id: number;
  enabled: boolean;
  hour: number;
  minute: number;
  day_of_week: number | null;
  retention_count: number;
  last_backup_at: string | null;
  updated_at: string;
};

type StorageFile = {
  name: string;
  created_at: string | null;
  metadata: { size: number } | null;
};

// ─── Constants ───────────────────────────────────────────────
const DAY_NAMES = ["Нед", "Пон", "Вт", "Ср", "Чет", "Пет", "Съб"];
const DAY_NAMES_FULL = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];

// ─── Helpers ─────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function calcNextBackup(schedule: BackupSchedule): Date | null {
  if (!schedule.enabled) return null;

  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(schedule.hour, schedule.minute, 0, 0);

  if (schedule.day_of_week === null) {
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  const targetDay = schedule.day_of_week;
  let daysUntil = targetDay - candidate.getDay();
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0 && candidate <= now) daysUntil = 7;
  candidate.setDate(candidate.getDate() + daysUntil);
  return candidate;
}

function isBackupDue(schedule: BackupSchedule): boolean {
  if (!schedule.enabled) return false;

  const now = new Date();
  const lastBackup = schedule.last_backup_at ? new Date(schedule.last_backup_at) : null;

  const candidate = new Date(now);
  candidate.setHours(schedule.hour, schedule.minute, 0, 0);

  if (schedule.day_of_week !== null && candidate.getDay() !== schedule.day_of_week) return false;
  if (candidate > now) return false;
  if (lastBackup && lastBackup >= candidate) return false;

  return true;
}

// ─── Main Component ───────────────────────────────────────────
export default function Backup() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoreFileConfirmOpen, setRestoreFileConfirmOpen] = useState(false);
  const [storageRestoreTarget, setStorageRestoreTarget] = useState<StorageFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageFile | null>(null);
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);

  const [scheduleForm, setScheduleForm] = useState({
    enabled: false,
    hour: 2,
    minute: 0,
    dayOfWeek: null as number | null,
    retentionCount: 10,
  });

  // ─── Queries ───────────────────────────────────────────────
  const { data: schedule, isLoading: scheduleLoading } = useQuery<BackupSchedule>({
    queryKey: ["backup_schedule"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_backup_schedule");
      if (error) throw error;
      const row = (data as BackupSchedule[])[0];
      if (!row) throw new Error("Не е намерен запис за разписание");
      return row;
    },
  });

  useEffect(() => {
    if (!schedule) return;
    setScheduleForm({
      enabled: schedule.enabled,
      hour: schedule.hour,
      minute: schedule.minute,
      dayOfWeek: schedule.day_of_week,
      retentionCount: schedule.retention_count,
    });
  }, [schedule]);

  const {
    data: storageFiles = [],
    isLoading: storageLoading,
  } = useQuery<StorageFile[]>({
    queryKey: ["backup_storage_files"],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("backups").list("", {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw error;
      return (data ?? []) as StorageFile[];
    },
  });

  // ─── Auto-backup check ─────────────────────────────────────
  useEffect(() => {
    if (!schedule || autoBackupRunning) return;
    if (!isBackupDue(schedule)) return;

    setAutoBackupRunning(true);
    toast.info("Автоматичен backup се изпълнява...");

    performStorageBackup(schedule.retention_count, true)
      .then(() => toast.success("Автоматичен backup завършен успешно"))
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setAutoBackupRunning(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule?.id]);

  // ─── Mutations ─────────────────────────────────────────────
  const saveScheduleMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_update_backup_schedule", {
        p_enabled: scheduleForm.enabled,
        p_hour: scheduleForm.hour,
        p_minute: scheduleForm.minute,
        p_day_of_week: scheduleForm.dayOfWeek,
        p_retention_count: scheduleForm.retentionCount,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Разписанието е запазено");
      queryClient.invalidateQueries({ queryKey: ["backup_schedule"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const { error } = await supabase.storage.from("backups").remove([filename]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Файлът е изтрит");
      queryClient.invalidateQueries({ queryKey: ["backup_storage_files"] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: async (jsonData: unknown) => {
      const { error } = await supabase.rpc("admin_restore_data", {
        p_data: jsonData,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Данните са възстановени успешно");
      queryClient.invalidateQueries();
      setStorageRestoreTarget(null);
      setRestoreFileConfirmOpen(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: Error) => toast.error(`Грешка при restore: ${e.message}`),
  });

  // ─── Core helpers ──────────────────────────────────────────
  async function fetchBackupData(): Promise<unknown> {
    const { data, error } = await supabase.rpc("admin_get_backup_data");
    if (error) throw new Error(error.message);
    return data;
  }

  async function downloadBackup() {
    try {
      const data = await fetchBackupData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `toolkeeper-backup-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup файлът е изтеглен");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Грешка при изтегляне");
    }
  }

  async function performStorageBackup(retentionCount: number, isAuto: boolean) {
    const data = await fetchBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `backup-${timestamp}.json`;

    const { error: uploadError } = await supabase.storage
      .from("backups")
      .upload(filename, blob, { contentType: "application/json", upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    if (isAuto) {
      await supabase.rpc("admin_record_backup_taken");
      queryClient.invalidateQueries({ queryKey: ["backup_schedule"] });
    }

    // Retention cleanup: list oldest first, delete if over limit
    const { data: files } = await supabase.storage.from("backups").list("", {
      limit: 200,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (files && files.length > retentionCount) {
      const toDelete = files.slice(0, files.length - retentionCount).map((f) => f.name);
      await supabase.storage.from("backups").remove(toDelete);
    }

    queryClient.invalidateQueries({ queryKey: ["backup_storage_files"] });
  }

  async function saveToStorage() {
    try {
      await performStorageBackup(schedule?.retention_count ?? 10, false);
      toast.success("Backup е запазен в Storage");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Грешка при запис в Storage");
    }
  }

  async function handleRestoreFromStorage(file: StorageFile) {
    try {
      const { data, error } = await supabase.storage.from("backups").download(file.name);
      if (error) throw error;
      const json = JSON.parse(await data.text());
      restoreMutation.mutate(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Грешка при четене на файл");
    }
  }

  async function handleRestoreFromFile() {
    if (!selectedFile) return;
    try {
      const json = JSON.parse(await selectedFile.text());
      restoreMutation.mutate(json);
    } catch {
      toast.error("Невалиден JSON файл");
    }
  }

  async function handleDownloadFromStorage(file: StorageFile) {
    const { data, error } = await supabase.storage.from("backups").download(file.name);
    if (error) { toast.error("Грешка при изтегляне"); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      toast.error("Моля, изберете .json файл");
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
  }

  // ─── Computed ──────────────────────────────────────────────
  const nextBackup = schedule ? calcNextBackup(schedule) : null;

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2">
          <DatabaseBackup className="w-6 h-6 text-primary" />
          Backup / Restore
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Архивиране и възстановяване на данните
        </p>
      </div>

      {/* ── 1. Manual backup ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            Ръчен backup
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={downloadBackup} className="gap-2">
            <Download className="w-4 h-4" />
            Изтегли JSON
          </Button>
          <Button onClick={saveToStorage} className="gap-2">
            <Cloud className="w-4 h-4" />
            Запази в Storage
          </Button>
        </CardContent>
      </Card>

      {/* ── 2. Auto-backup schedule ───────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Автоматичен backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {scheduleLoading ? (
            <p className="text-sm text-muted-foreground">Зареждане...</p>
          ) : (
            <>
              {/* Enabled toggle */}
              <div className="flex items-center gap-3">
                <Switch
                  id="auto-enabled"
                  checked={scheduleForm.enabled}
                  onCheckedChange={(v) => setScheduleForm((f) => ({ ...f, enabled: v }))}
                />
                <Label htmlFor="auto-enabled">
                  {scheduleForm.enabled ? "Активирано" : "Деактивирано"}
                </Label>
              </div>

              {/* Day of week */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Ден
                </Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleForm((f) => ({ ...f, dayOfWeek: null }))}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      scheduleForm.dayOfWeek === null
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    Всеки ден
                  </button>
                  {DAY_NAMES.map((name, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setScheduleForm((f) => ({ ...f, dayOfWeek: idx }))}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        scheduleForm.dayOfWeek === idx
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time + retention */}
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label>Час</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={scheduleForm.hour}
                    onChange={(e) =>
                      setScheduleForm((f) => ({
                        ...f,
                        hour: Math.min(23, Math.max(0, Number(e.target.value))),
                      }))
                    }
                    className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Минута</Label>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={scheduleForm.minute}
                    onChange={(e) =>
                      setScheduleForm((f) => ({
                        ...f,
                        minute: Math.min(59, Math.max(0, Number(e.target.value))),
                      }))
                    }
                    className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Запази последни</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={scheduleForm.retentionCount}
                      onChange={(e) =>
                        setScheduleForm((f) => ({
                          ...f,
                          retentionCount: Math.min(50, Math.max(1, Number(e.target.value))),
                        }))
                      }
                      className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-sm text-muted-foreground">backup-а</span>
                  </div>
                </div>
              </div>

              {/* Status info */}
              <div className="text-sm text-muted-foreground space-y-1">
                {nextBackup && (
                  <p>
                    Следващ backup:{" "}
                    <span className="font-medium text-foreground">
                      {format(nextBackup, "dd.MM.yyyy HH:mm")}
                      {" — "}
                      {scheduleForm.dayOfWeek === null
                        ? "всеки ден"
                        : `всяка ${DAY_NAMES_FULL[scheduleForm.dayOfWeek]}`}
                    </span>
                  </p>
                )}
                {schedule?.last_backup_at && (
                  <p>
                    Последен автоматичен backup:{" "}
                    <span className="font-medium text-foreground">
                      {format(new Date(schedule.last_backup_at), "dd.MM.yyyy HH:mm")}
                    </span>
                  </p>
                )}
                {autoBackupRunning && (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                    Backup в момента...
                  </Badge>
                )}
              </div>

              <Button
                onClick={() => saveScheduleMutation.mutate()}
                disabled={saveScheduleMutation.isPending}
                className="gap-2"
              >
                <Save className="w-4 h-4" />
                {saveScheduleMutation.isPending ? "Запазване..." : "Запази разписание"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── 3. Storage history ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="w-4 h-4 text-primary" />
            История (Storage)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Файл</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Размер</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storageLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                    Зареждане...
                  </TableCell>
                </TableRow>
              )}
              {!storageLoading && storageFiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Няма запазени backup файлове в Storage
                  </TableCell>
                </TableRow>
              )}
              {!storageLoading &&
                storageFiles.map((file) => (
                  <TableRow key={file.name}>
                    <TableCell className="font-mono text-xs">{file.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {file.created_at
                        ? format(new Date(file.created_at), "dd.MM.yyyy HH:mm")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {file.metadata?.size ? formatFileSize(file.metadata.size) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Изтегли"
                          onClick={() => handleDownloadFromStorage(file)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Restore"
                          onClick={() => setStorageRestoreTarget(file)}
                        >
                          <RotateCcw className="w-4 h-4 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Изтрий"
                          onClick={() => setDeleteTarget(file)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── 4. Restore from local file ────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            Restore от файл
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Изберете .json backup файл от вашия компютър. Всички текущи данни ще бъдат
            изтрити и заменени с тези от файла.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="restore-file">JSON файл</Label>
              <Input
                id="restore-file"
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelect}
                className="w-72"
              />
            </div>
            <Button
              variant="destructive"
              disabled={!selectedFile || restoreMutation.isPending}
              onClick={() => setRestoreFileConfirmOpen(true)}
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {restoreMutation.isPending ? "Възстановяване..." : "Restore"}
            </Button>
          </div>
          {selectedFile && (
            <p className="text-xs text-muted-foreground">
              Избран файл:{" "}
              <span className="font-medium">{selectedFile.name}</span>
              {" · "}
              {formatFileSize(selectedFile.size)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ─── Confirm dialogs ──────────────────────────────────── */}

      <ConfirmDialog
        open={restoreFileConfirmOpen}
        onOpenChange={setRestoreFileConfirmOpen}
        variant="destructive"
        title="Restore от файл"
        description={
          <span>
            Сигурни ли сте? Всички текущи данни (категории, служители, инвентар, движения,
            ремонти) ще бъдат <strong>изтрити безвъзвратно</strong> и заменени с тези от{" "}
            <strong>{selectedFile?.name}</strong>.
          </span>
        }
        confirmLabel="Да, изтрий и възстанови"
        loading={restoreMutation.isPending}
        onConfirm={handleRestoreFromFile}
      />

      <ConfirmDialog
        open={!!storageRestoreTarget}
        onOpenChange={(open) => !open && setStorageRestoreTarget(null)}
        variant="destructive"
        title="Restore от Storage"
        description={
          <span>
            Сигурни ли сте? Всички текущи данни ще бъдат{" "}
            <strong>изтрити безвъзвратно</strong> и заменени с тези от{" "}
            <strong>{storageRestoreTarget?.name}</strong>.
          </span>
        }
        confirmLabel="Да, изтрий и възстанови"
        loading={restoreMutation.isPending}
        onConfirm={() => {
          if (storageRestoreTarget) handleRestoreFromStorage(storageRestoreTarget);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        variant="destructive"
        title="Изтриване на backup"
        description={`Сигурни ли сте, че искате да изтриете ${deleteTarget?.name}? Това действие е необратимо.`}
        confirmLabel="Изтрий"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.name);
        }}
      />
    </div>
  );
}
