import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Package, Pencil, Plus, Search, Trash2, UserCheck, UserMinus, Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import excelIcon from "@/assets/excell.svg";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function Employees() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: string;
    name: string;
    items: { itemId: string; code: string; category: string }[];
  } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [deactivateReasonDialog, setDeactivateReasonDialog] = useState<{ id: string; name: string } | null>(null);
  const [deactivationReason, setDeactivationReason] = useState("");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Името е задължително");
      const { error } = await supabase.from("employees").insert({ name: trimmedName, position: position.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Служителят е добавен");
      setAddOpen(false);
      setName("");
      setPosition("");
      queryClient.invalidateQueries({ queryKey: ["employees_all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = editName.trim();
      if (!trimmedName) throw new Error("Името е задължително");
      const { error } = await supabase
        .from("employees")
        .update({
          name: trimmedName,
          position: editPosition.trim() || null,
        })
        .eq("id", editEmployeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Служителят е редактиран успешно!");
      setEditOpen(false);
      setEditEmployeeId("");
      setEditName("");
      setEditPosition("");
      queryClient.invalidateQueries({ queryKey: ["employees_all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive, reason }: { id: string; isActive: boolean; reason?: string }) => {
      // Get current employee data
      const { data: employee } = await supabase
        .from("employees")
        .select("name")
        .eq("id", id)
        .single();

      if (!employee) throw new Error("Служителят не е намерен");

      const updateData: any = { is_active: !isActive };

      // If deactivating, add prefix, reason and timestamp
      if (isActive && reason) {
        // Add X emoji prefix if not already present
        const newName = employee.name.startsWith("❌ ") ? employee.name : `❌ ${employee.name}`;
        updateData.name = newName;
        updateData.deactivation_reason = reason;
        updateData.deactivated_at = new Date().toISOString();
      }

      // If reactivating, remove prefix, clear reason and timestamp
      if (!isActive) {
        // Remove X emoji prefix
        const newName = employee.name.replace(/^❌\s/, '');
        updateData.name = newName;
        updateData.deactivation_reason = null;
        updateData.deactivated_at = null;
      }

      const { error } = await supabase.from("employees").update(updateData).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees_all"] });
      toast.success("Статусът е променен");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Проверка дали служителят има движения
      const { count, error: countErr } = await supabase
        .from("movements")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", id);
      if (countErr) throw countErr;
      if (count && count > 0) {
        throw new Error("Служителят има записани движения и не може да бъде изтрит. Използвайте деактивиране вместо това.");
      }
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees_all"] });
      toast.success("Служителят е изтрит");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deactivateWithReturnMutation = useMutation({
    mutationFn: async ({ employeeId, reason }: { employeeId: string; reason: string }) => {
      // Get current employee name
      const { data: employee } = await supabase
        .from("employees")
        .select("name")
        .eq("id", employeeId)
        .single();

      if (!employee) throw new Error("Служителят не е намерен");

      // Use atomic SQL function to deactivate employee and return items in one transaction
      const { error } = await supabase.rpc("deactivate_employee_with_returns", {
        _employee_id: employeeId,
        _issued_by_user_id: user?.id,
      });
      if (error) throw error;

      // Add prefix, update deactivation reason and timestamp
      const newName = employee.name.startsWith("❌ ") ? employee.name : `❌ ${employee.name}`;
      const { error: updateErr } = await supabase
        .from("employees")
        .update({
          name: newName,
          deactivation_reason: reason,
          deactivated_at: new Date().toISOString(),
        })
        .eq("id", employeeId);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees_all"] });
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      queryClient.invalidateQueries({ queryKey: ["recent_movements"] });
      toast.success("Служителят е деактивиран и артикулите са върнати");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDeactivate = async (id: string, empName: string) => {
    // Check for assigned items before deactivating
    const { data: assignedItems, error: itemsErr } = await supabase
      .from("inventory_items")
      .select("id, inventory_code, categories(name)")
      .eq("status", "assigned");

    if (itemsErr) {
      toast.error("Грешка при проверка на артикулите");
      return;
    }

    if (assignedItems && assignedItems.length > 0) {
      const assignedIds = assignedItems.map((a) => a.id);

      // Get all issue movements for assigned items, then filter client-side
      const { data: allMovements, error: movErr } = await supabase
        .from("movements")
        .select("item_id, employee_id, created_at")
        .eq("movement_type", "issue")
        .in("item_id", assignedIds)
        .order("created_at", { ascending: false });

      if (movErr) {
        toast.error("Грешка при проверка на движенията");
        return;
      }

      // Client-side deduplication: keep only latest movement per item
      const seen = new Set<string>();
      const latestMovements = (allMovements ?? []).filter((m) => {
        if (seen.has(m.item_id)) return false;
        seen.add(m.item_id);
        return true;
      });

      // Filter for this employee only
      const employeeMovements = latestMovements.filter((m) => m.employee_id === id);

      if (employeeMovements.length > 0) {
        // Map movements to items with details
        const empItems = employeeMovements.map((m) => {
          const item = assignedItems.find((i) => i.id === m.item_id);
          return {
            itemId: m.item_id,
            code: item?.inventory_code ?? "—",
            category: (item?.categories as { name: string } | null)?.name ?? "",
          };
        });

        setDeactivateTarget({ id, name: empName, items: empItems });
        return;
      }
    }

    // No items — show reason dialog
    setDeactivateReasonDialog({ id, name: empName });
  };

  const filteredEmployees = employees.filter((e) => {
    if (statusFilter === "active" && !e.is_active) return false;
    if (statusFilter === "inactive" && e.is_active) return false;
    if (searchQuery && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const exportToExcel = () => {
    const data = filteredEmployees.map((emp) => ({
      "Име": emp.name,
      "Длъжност": emp.position || "",
      "Статус": emp.is_active ? "Активен" : "Неактивен",
      "Причина за деактивиране": !emp.is_active && emp.deactivation_reason ? emp.deactivation_reason : "",
      "Дата на деактивиране": !emp.is_active && emp.deactivated_at ? format(new Date(emp.deactivated_at), "dd.MM.yyyy") : "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Служители");
    XLSX.writeFile(wb, `Служители_${format(new Date(), "dd-MM-yyyy")}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Служители</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredEmployees.length} служител{filteredEmployees.length !== 1 ? "и" : ""}
            {(statusFilter !== "all" || searchQuery) && ` (от ${employees.length} общо)`}
            {statusFilter === "all" && !searchQuery && ` • ${employees.filter((e) => e.is_active).length} активни`}
          </p>
        </div>

        <div className="flex justify-center">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Добави служител
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Нов служител</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Име</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Пълно име" />
              </div>
              <div className="space-y-2">
                <Label>Длъжност</Label>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Длъжност (по избор)" />
              </div>
              <Button onClick={() => addMutation.mutate()} disabled={!name.trim() || addMutation.isPending} className="w-full">
                {addMutation.isPending ? "Запазване..." : "Добави"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Филтър по статус">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всички</SelectItem>
              <SelectItem value="active">Активни</SelectItem>
              <SelectItem value="inactive">Неактивни</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Търсене по име..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Търсене по име"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={exportToExcel}
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary/40 bg-muted/50 opacity-70 transition-all hover:opacity-100 hover:border-primary hover:bg-muted shrink-0"
                aria-label="Експорт в Excel"
              >
                <img src={excelIcon} alt="Excel" className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Експорт в Excel</TooltipContent>
          </Tooltip>
        </div>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Име</TableHead>
                <TableHead>Длъжност</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    {searchQuery || statusFilter !== "all" ? "Няма съвпадения" : "Няма служители"}
                  </TableCell>
                </TableRow>
              )}
              {filteredEmployees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell className="text-muted-foreground">{e.position || "-"}</TableCell>
                  <TableCell>
                    {e.is_active ? (
                      <Badge
                        variant="outline"
                        className="bg-success/10 text-success border-success/20"
                      >
                        Активен
                      </Badge>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <Badge
                              variant="outline"
                              className="bg-muted text-muted-foreground cursor-help"
                            >
                              Неактивен
                            </Badge>
                            {e.deactivation_reason && (
                              <span className="text-xs text-muted-foreground">
                                {e.deactivation_reason}
                              </span>
                            )}
                          </div>
                        </TooltipTrigger>
                        {e.deactivation_reason && e.deactivated_at && (
                          <TooltipContent>
                            <div className="text-xs">
                              <div>Причина: {e.deactivation_reason}</div>
                              <div>Дата: {format(new Date(e.deactivated_at), "dd.MM.yyyy")}</div>
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditEmployeeId(e.id);
                          setEditName(e.name);
                          setEditPosition(e.position || "");
                          setEditOpen(true);
                        }}
                        title="Редакция"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          e.is_active
                            ? handleDeactivate(e.id, e.name)
                            : toggleMutation.mutate({ id: e.id, isActive: false })
                        }
                        title={e.is_active ? "Деактивирай" : "Активирай"}
                      >
                        {e.is_active ? (
                          <UserMinus className="w-4 h-4 text-destructive" />
                        ) : (
                          <UserCheck className="w-4 h-4 text-success" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget({ id: e.id, name: e.name })}
                        title="Изтрий"
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

      {/* Edit employee dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => {
        setEditOpen(open);
        if (!open) {
          setEditEmployeeId("");
          setEditName("");
          setEditPosition("");
        }
      }}>
        <DialogContent className="[&>button:last-of-type]:hover:rotate-90 [&>button:last-of-type]:transition-transform [&>button:last-of-type]:duration-200">
          <DialogHeader>
            <DialogTitle>Редакция на служител</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Име</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Пълно име"
              />
            </div>
            <div className="space-y-2">
              <Label>Длъжност</Label>
              <Input
                value={editPosition}
                onChange={(e) => setEditPosition(e.target.value)}
                placeholder="Длъжност (по избор)"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditOpen(false);
                  setEditEmployeeId("");
                  setEditName("");
                  setEditPosition("");
                }}
              >
                Отказ
              </Button>
              <Button
                onClick={() => editMutation.mutate()}
                disabled={!editName.trim() || editMutation.isPending}
              >
                {editMutation.isPending ? "Запазване..." : "Запази"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivation reason dialog */}
      <Dialog open={!!deactivateReasonDialog} onOpenChange={(open) => {
        if (!open) {
          setDeactivateReasonDialog(null);
          setDeactivationReason("");
        }
      }}>
        <DialogContent className="[&>button:last-of-type]:hover:rotate-90 [&>button:last-of-type]:transition-transform [&>button:last-of-type]:duration-200">
          <DialogHeader>
            <DialogTitle>Деактивиране на служител</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Изберете причина за деактивиране на <span className="font-medium text-foreground">{deactivateReasonDialog?.name}</span>:
            </p>
            <div className="space-y-2">
              <Label>Причина</Label>
              <Select value={deactivationReason} onValueChange={setDeactivationReason}>
                <SelectTrigger><SelectValue placeholder="Изберете причина" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Напуснал">🚶 Напуснал</SelectItem>
                  <SelectItem value="Уволнен">❌ Уволнен</SelectItem>
                  <SelectItem value="Дългосрочен отпуск">🏖️ Дългосрочен отпуск</SelectItem>
                  <SelectItem value="Пенсиониран">👴 Пенсиониран</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeactivateReasonDialog(null);
                  setDeactivationReason("");
                }}
              >
                Отказ
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (deactivateReasonDialog && deactivationReason) {
                    toggleMutation.mutate(
                      { id: deactivateReasonDialog.id, isActive: true, reason: deactivationReason },
                      {
                        onSuccess: () => {
                          setDeactivateReasonDialog(null);
                          setDeactivationReason("");
                        },
                      }
                    );
                  }
                }}
                disabled={!deactivationReason || toggleMutation.isPending}
              >
                {toggleMutation.isPending ? "Обработка..." : "Деактивирай"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        variant="destructive"
        title="Изтриване на служител"
        description={`Сигурни ли сте, че искате да изтриете ${deleteTarget?.name}? Това действие е необратимо.`}
        confirmLabel="Изтрий"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id, {
              onSettled: () => setDeleteTarget(null),
            });
          }
        }}
      />

      {/* Deactivation warning — employee has assigned items */}
      <Dialog open={!!deactivateTarget} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-primary shrink-0" />
              Служителят има отдадени артикули
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deactivateTarget?.name}</span> има{" "}
            <span className="font-medium text-foreground">{deactivateTarget?.items.length}</span> отдаден
            {(deactivateTarget?.items.length ?? 0) !== 1 ? "и" : ""} артикул
            {(deactivateTarget?.items.length ?? 0) !== 1 ? "а" : ""}:
          </p>

          <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
            {deactivateTarget?.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-secondary/50 border border-border/50">
                <Package className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-sm font-mono font-medium">{item.code}</span>
                <span className="text-xs text-muted-foreground">{item.category}</span>
              </div>
            ))}
          </div>

          <p className="text-sm text-primary font-medium">
            При деактивиране всички артикули ще бъдат автоматично върнати в склада.
          </p>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Причина за деактивиране</Label>
              <Select value={deactivationReason} onValueChange={setDeactivationReason}>
                <SelectTrigger><SelectValue placeholder="Изберете причина" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Напуснал">🚶 Напуснал</SelectItem>
                  <SelectItem value="Уволнен">❌ Уволнен</SelectItem>
                  <SelectItem value="Дългосрочен отпуск">🏖️ Дългосрочен отпуск</SelectItem>
                  <SelectItem value="Пенсиониран">👴 Пенсиониран</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => {
                setDeactivateTarget(null);
                setDeactivationReason("");
              }}>
                Отказ
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirmDeactivate(true)}
                disabled={!deactivationReason}
              >
                Върни артикулите и деактивирай
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={(open) => !open && setConfirmDeactivate(false)}
        variant="warning"
        title="Потвърждение"
        description={`${deactivateTarget?.items.length ?? 0} артикула ще бъдат върнати в склада и ${deactivateTarget?.name} ще бъде деактивиран. Сигурни ли сте?`}
        confirmLabel="Да, продължи"
        loading={deactivateWithReturnMutation.isPending}
        onConfirm={() => {
          if (deactivateTarget && deactivationReason) {
            deactivateWithReturnMutation.mutate(
              {
                employeeId: deactivateTarget.id,
                reason: deactivationReason,
              },
              {
                onSettled: () => {
                  setConfirmDeactivate(false);
                  setDeactivateTarget(null);
                  setDeactivationReason("");
                },
              },
            );
          }
        }}
      />
    </div>
  );
}
