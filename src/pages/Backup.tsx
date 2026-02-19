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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DatabaseBackup,
  Download,
  Upload,
  Cloud,
  Trash2,
  RotateCcw,
  Clock,
  Save,
  TriangleAlert,
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
  day_of_month: number | null;
  retention_count: number;
  last_backup_at: string | null;
  updated_at: string;
};

type StorageFile = {
  name: string;
  created_at: string | null;
  metadata: { size: number } | null;
};

type Frequency = "daily" | "weekly" | "monthly";

// ─── Constants ───────────────────────────────────────────────
const WEEK_DAYS = ["Нед", "Пон", "Вт", "Ср", "Чет", "Пет", "Съб"];
const WEEK_DAYS_FULL = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];
const MONTH_DAY_SUFFIXES: Record<number, string> = { 1: "-ви", 2: "-ри", 7: "-ми", 8: "-ми" };
function ordinal(n: number) {
  return `${n}${MONTH_DAY_SUFFIXES[n] ?? "-ти"}`;
}

// ─── Helpers ─────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function deriveFrequency(s: BackupSchedule): Frequency {
  if (s.day_of_month !== null) return "monthly";
  if (s.day_of_week !== null) return "weekly";
  return "daily";
}

function calcNextBackup(schedule: BackupSchedule): Date | null {
  if (!schedule.enabled) return null;
  const now = new Date();

  if (schedule.day_of_month !== null) {
    // Monthly: find next occurrence of day_of_month
    const target = schedule.day_of_month;
    const candidate = new Date(now.getFullYear(), now.getMonth(), target, schedule.hour, schedule.minute, 0, 0);
    if (candidate <= now) {
      // Move to next month
      candidate.setMonth(candidate.getMonth() + 1);
    }
    return candidate;
  }

  const candidate = new Date(now);
  candidate.setHours(schedule.hour, schedule.minute, 0, 0);

  if (schedule.day_of_week === null) {
    // Daily
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  // Weekly
  let daysUntil = schedule.day_of_week - candidate.getDay();
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

  if (schedule.day_of_month !== null) {
    if (now.getDate() !== schedule.day_of_month) return false;
  } else if (schedule.day_of_week !== null) {
    if (now.getDay() !== schedule.day_of_week) return false;
  }

  if (candidate > now) return false;
  if (lastBackup && lastBackup >= candidate) return false;
  return true;
}

// ─── Day-of-month grid component ─────────────────────────────
function DayOfMonthPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (day: number) => void;
}) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  // Arrange in rows of 7 (like a calendar)
  const rows: number[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    rows.push(days.slice(i, i + 7));
  }

  return (
    <div className="space-y-1">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-1">
          {row.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => onChange(day)}
              className={`w-9 h-9 rounded-md text-sm font-medium border transition-colors ${
                value === day
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
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
  const [clearStep1Open, setClearStep1Open] = useState(false);
  const [clearStep2Open, setClearStep2Open] = useState(false);
  const [clearPin, setClearPin] = useState("");
  const [clearNoBackupOpen, setClearNoBackupOpen] = useState(false);

  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [scheduleForm, setScheduleForm] = useState({
    enabled: false,
    hour: 2,
    minute: 0,
    dayOfWeek: 1 as number,    // used when frequency === "weekly"
    dayOfMonth: 1 as number,   // used when frequency === "monthly"
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
    setFrequency(deriveFrequency(schedule));
    setScheduleForm({
      enabled: schedule.enabled,
      hour: schedule.hour,
      minute: schedule.minute,
      dayOfWeek: schedule.day_of_week ?? 1,
      dayOfMonth: schedule.day_of_month ?? 1,
      retentionCount: schedule.retention_count,
    });
  }, [schedule]);

  const { data: storageFiles = [], isLoading: storageLoading } = useQuery<StorageFile[]>({
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
        p_day_of_week: frequency === "weekly" ? scheduleForm.dayOfWeek : null,
        p_retention_count: scheduleForm.retentionCount,
        p_day_of_month: frequency === "monthly" ? scheduleForm.dayOfMonth : null,
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
      const { error } = await supabase.rpc("admin_restore_data", { p_data: jsonData });
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

  const clearMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_clear_data");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Базата е изчистена успешно");
      queryClient.invalidateQueries();
      setClearStep2Open(false);
      setClearPin("");
    },
    onError: (e: Error) => toast.error(e.message),
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
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `toolkeeper-backup-${ts}.json`;
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
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `backup-${ts}.json`;

    const { error: uploadError } = await supabase.storage
      .from("backups")
      .upload(filename, blob, { contentType: "application/json", upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    if (isAuto) {
      await supabase.rpc("admin_record_backup_taken");
      queryClient.invalidateQueries({ queryKey: ["backup_schedule"] });
    }

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
      restoreMutation.mutate(JSON.parse(await data.text()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Грешка при четене на файл");
    }
  }

  async function handleRestoreFromFile() {
    if (!selectedFile) return;
    try {
      restoreMutation.mutate(JSON.parse(await selectedFile.text()));
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

  // ─── Derived display values ────────────────────────────────
  const nextBackup = schedule ? calcNextBackup({ ...schedule, day_of_week: frequency === "weekly" ? scheduleForm.dayOfWeek : null, day_of_month: frequency === "monthly" ? scheduleForm.dayOfMonth : null, enabled: scheduleForm.enabled, hour: scheduleForm.hour, minute: scheduleForm.minute }) : null;

  function frequencyLabel(): string {
    if (frequency === "daily") return "всеки ден";
    if (frequency === "weekly") return `всяка ${WEEK_DAYS_FULL[scheduleForm.dayOfWeek]}`;
    return `всяко ${ordinal(scheduleForm.dayOfMonth)} число на месеца`;
  }

  const numInput = "w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  const pillBase = "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors";
  const pillActive = "bg-primary text-primary-foreground border-primary";
  const pillInactive = "border-border text-muted-foreground hover:border-primary/50";

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

              {/* Frequency selector */}
              <div className="space-y-2">
                <Label>Честота</Label>
                <div className="flex gap-2">
                  {(["daily", "weekly", "monthly"] as Frequency[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={`${pillBase} ${frequency === f ? pillActive : pillInactive}`}
                    >
                      {f === "daily" ? "Всеки ден" : f === "weekly" ? "Седмично" : "Месечно"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weekly: day-of-week picker */}
              {frequency === "weekly" && (
                <div className="space-y-2">
                  <Label>Ден от седмицата</Label>
                  <div className="flex flex-wrap gap-2">
                    {WEEK_DAYS.map((name, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setScheduleForm((f) => ({ ...f, dayOfWeek: idx }))}
                        className={`${pillBase} ${scheduleForm.dayOfWeek === idx ? pillActive : pillInactive}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly: day-of-month calendar grid */}
              {frequency === "monthly" && (
                <div className="space-y-2">
                  <Label>Ден от месеца</Label>
                  <DayOfMonthPicker
                    value={scheduleForm.dayOfMonth}
                    onChange={(day) => setScheduleForm((f) => ({ ...f, dayOfMonth: day }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ако месецът има по-малко дни (напр. Февруари), backup-ът ще се пропусне за него.
                  </p>
                </div>
              )}

              {/* Time + retention */}
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label>Час</Label>
                  <Input
                    type="number" min={0} max={23}
                    value={scheduleForm.hour}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, hour: Math.min(23, Math.max(0, Number(e.target.value))) }))}
                    className={numInput}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Минута</Label>
                  <Input
                    type="number" min={0} max={59}
                    value={scheduleForm.minute}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, minute: Math.min(59, Math.max(0, Number(e.target.value))) }))}
                    className={numInput}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Запази последни</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={1} max={50}
                      value={scheduleForm.retentionCount}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, retentionCount: Math.min(50, Math.max(1, Number(e.target.value))) }))}
                      className={numInput}
                    />
                    <span className="text-sm text-muted-foreground">backup-а</span>
                  </div>
                </div>
              </div>

              {/* Status info */}
              <div className="text-sm text-muted-foreground space-y-1">
                {nextBackup && scheduleForm.enabled && (
                  <p>
                    Следващ backup:{" "}
                    <span className="font-medium text-foreground">
                      {format(nextBackup, "dd.MM.yyyy")} в {String(scheduleForm.hour).padStart(2, "0")}:{String(scheduleForm.minute).padStart(2, "0")}
                      {" — "}
                      {frequencyLabel()}
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
              {!storageLoading && storageFiles.map((file) => (
                <TableRow key={file.name}>
                  <TableCell className="font-mono text-xs">{file.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {file.created_at ? format(new Date(file.created_at), "dd.MM.yyyy HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {file.metadata?.size ? formatFileSize(file.metadata.size) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" title="Изтегли" onClick={() => handleDownloadFromStorage(file)}>
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" title="Restore" onClick={() => setStorageRestoreTarget(file)}>
                        <RotateCcw className="w-4 h-4 text-primary" />
                      </Button>
                      <Button variant="ghost" size="sm" title="Изтрий" onClick={() => setDeleteTarget(file)}>
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
              Избран файл: <span className="font-medium">{selectedFile.name}</span>
              {" · "}{formatFileSize(selectedFile.size)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 5. Danger zone ───────────────────────────────────── */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <TriangleAlert className="w-4 h-4" />
            Зона на опасност
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Изтрива <strong>всички</strong> категории, служители, инвентар, движения и ремонти.
            Използвай само за тестване на Restore. Действието е <strong>необратимо</strong>.
          </p>
          <Button
            variant="destructive"
            onClick={() => {
              if (storageFiles.length === 0) {
                setClearNoBackupOpen(true);
              } else {
                setClearStep1Open(true);
              }
            }}
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Изчисти базата
          </Button>
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

      {/* Step 0: no backup warning */}
      <ConfirmDialog
        open={clearNoBackupOpen}
        onOpenChange={(open) => { if (!open) setClearNoBackupOpen(false); }}
        variant="destructive"
        title="Няма направен backup!"
        description={
          <span>
            <strong>Не е намерен backup файл в Storage.</strong>
            {" "}Препоръчваме първо да направите backup, за да можете да възстановите данните при нужда.
            <br /><br />
            Сигурни ли сте, че искате да продължите <strong>без backup</strong>?
          </span>
        }
        confirmLabel="Продължи без backup"
        onConfirm={() => {
          setClearNoBackupOpen(false);
          setClearStep1Open(true);
        }}
      />

      {/* Step 1: first confirmation */}
      <ConfirmDialog
        open={clearStep1Open}
        onOpenChange={(open) => { if (!open) setClearStep1Open(false); }}
        variant="destructive"
        title="Изчистване на базата"
        description={
          <span>
            Сигурни ли сте? Всички категории, служители, инвентар, движения и ремонти ще бъдат{" "}
            <strong>изтрити безвъзвратно</strong>. Тази операция е само за тестване на Restore.
          </span>
        }
        confirmLabel="Да, продължи"
        onConfirm={() => {
          setClearStep1Open(false);
          setClearPin("");
          setClearStep2Open(true);
        }}
      />

      {/* Step 2: PIN confirmation */}
      <Dialog open={clearStep2Open} onOpenChange={(open) => { if (!open) { setClearStep2Open(false); setClearPin(""); } }}>
        <DialogContent className="border-destructive/40 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="w-4 h-4" />
              Въведи PIN за потвърждение
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Въведи <strong>0000</strong>, за да потвърдиш изчистването на базата.
            </p>
            <Input
              type="password"
              placeholder="••••"
              maxLength={4}
              value={clearPin}
              onChange={(e) => setClearPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && clearPin === "0000") clearMutation.mutate();
              }}
              className="text-center text-xl tracking-widest w-32 mx-auto block"
              autoFocus
            />
          </div>
          <DialogFooter className="sm:justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => { setClearStep2Open(false); setClearPin(""); }}
              disabled={clearMutation.isPending}
            >
              Отказ
            </Button>
            <Button
              variant="destructive"
              disabled={clearPin !== "0000" || clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
            >
              {clearMutation.isPending ? "Изчистване..." : "Изчисти базата"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
