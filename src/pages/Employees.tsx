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
import { AlertTriangle, Package, Plus, Search, Trash2, UserCheck, UserMinus, Users } from "lucide-react";
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

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from("employees").update({ is_active: !isActive }).eq("id", id);
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
    mutationFn: async ({ employeeId }: { employeeId: string }) => {
      // Use atomic SQL function to deactivate employee and return items in one transaction
      const { error } = await supabase.rpc("deactivate_employee_with_returns", {
        _employee_id: employeeId,
        _issued_by_user_id: user?.id,
      });
      if (error) throw error;
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
    const { data: assignedItems } = await supabase
      .from("inventory_items")
      .select("id")
      .eq("status", "assigned");
    if (assignedItems && assignedItems.length > 0) {
      const assignedIds = assignedItems.map((a) => a.id);
      // Use VIEW for automatic deduplication
      const { data: movements } = await supabase
        .from("latest_issue_movements")
        .select("item_id, inventory_items(inventory_code, categories(name))")
        .in("item_id", assignedIds)
        .eq("employee_id", id);
      const empItems = (movements ?? []).map((m) => ({
        itemId: m.item_id,
        code: (m.inventory_items as { inventory_code: string } | null)?.inventory_code ?? "—",
        category: (m.inventory_items as { categories: { name: string } | null } | null)?.categories?.name ?? "",
      }));
      if (empItems.length > 0) {
        setDeactivateTarget({ id, name: empName, items: empItems });
        return;
      }
    }
    // No items — deactivate directly
    toggleMutation.mutate({ id, isActive: true });
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
                    <Badge
                      variant="outline"
                      className={e.is_active ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground"}
                    >
                      {e.is_active ? "Активен" : "Неактивен"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
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

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setDeactivateTarget(null)}>
              Отказ
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirmDeactivate(true)}
            >
              Върни артикулите и деактивирай
            </Button>
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
          if (deactivateTarget) {
            deactivateWithReturnMutation.mutate(
              {
                employeeId: deactivateTarget.id,
              },
              {
                onSettled: () => {
                  setConfirmDeactivate(false);
                  setDeactivateTarget(null);
                },
              },
            );
          }
        }}
      />
    </div>
  );
}
