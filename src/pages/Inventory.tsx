import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Wrench, Package, AlertTriangle, Search, ChevronLeft, ChevronRight, RotateCcw, History, Info, ArrowUp, ArrowDown, ArrowUpDown, Pencil, Trash2, X } from "lucide-react";
import { ItemHistoryDialog } from "@/components/ItemHistoryDialog";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";
import excelIcon from "@/assets/excell.svg";

type InventoryItemWithCategory = Tables<"inventory_items"> & {
  categories: { name: string } | null;
};

type MovementAssignment = {
  item_id: string;
  employees: { name: string } | null;
  created_at: string;
};

export default function Inventory() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();

  const [addOpen, setAddOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [writeOffNote, setWriteOffNote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showWrittenOff, setShowWrittenOff] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Read status filter from URL params
  useEffect(() => {
    const status = searchParams.get('status');
    if (status) {
      setStatusFilter(status);
      if (status === 'written_off') {
        setShowWrittenOff(true);
      } else {
        setShowWrittenOff(false);
      }
    }
  }, [searchParams]);

  // Sort
  type SortKey = "code" | "category" | "ownership" | "price" | "repairs" | "totalRepair" | "status";
  const [sortKey, setSortKey] = useState<SortKey | null>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Add item form
  const [newCode, setNewCode] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newOwnership, setNewOwnership] = useState<"milkos" | "rent">("milkos");

  // Repair form
  const [repairCost, setRepairCost] = useState("");
  const [repairNotes, setRepairNotes] = useState("");

  // Confirm send to repair
  const [repairConfirmId, setRepairConfirmId] = useState<string | null>(null);

  // Confirm delete
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

  // History dialog
  const [historyItem, setHistoryItem] = useState<{ id: string; code: string } | null>(null);

  // Edit item dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editItemId, setEditItemId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editOwnership, setEditOwnership] = useState<"milkos" | "rent">("milkos");
  const [editOriginalOwnership, setEditOriginalOwnership] = useState<"milkos" | "rent">("milkos");
  const [editNotes, setEditNotes] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("code_from");
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["inventory_items_all", filterCategory],
    queryFn: async () => {
      let q = supabase.from("inventory_items").select("*, categories(name)");
      if (filterCategory && filterCategory !== "all") q = q.eq("category_id", filterCategory);
      const { data, error } = await q.order("inventory_code");
      if (error) throw error;
      return data as InventoryItemWithCategory[];
    },
  });

  // Repair history for tooltips
  const { data: repairHistory = [] } = useQuery({
    queryKey: ["inventory_repair_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repair_history")
        .select("item_id, cost, notes, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("repair_history query failed:", error.message);
        return [];
      }
      return data ?? [];
    },
    retry: false,
  });

  const repairsByItem = repairHistory.reduce<Record<string, typeof repairHistory>>((acc, r) => {
    if (!acc[r.item_id]) acc[r.item_id] = [];
    acc[r.item_id].push(r);
    return acc;
  }, {});

  // Latest assignment per item (for status tooltip showing employee name)
  const { data: assignments = [] } = useQuery({
    queryKey: ["inventory_assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movements")
        .select("item_id, employees(name), created_at")
        .eq("movement_type", "issue")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("assignments query failed:", error.message);
        return [];
      }
      return (data ?? []) as MovementAssignment[];
    },
    retry: false,
  });

  // Map: item_id -> employee name (keep only latest per item)
  const assignedTo = assignments.reduce<Record<string, string>>((acc, m) => {
    if (!acc[m.item_id] && m.employees?.name) {
      acc[m.item_id] = m.employees.name;
    }
    return acc;
  }, {});

  const validateCodeInRange = (code: string, categoryId: string): boolean => {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return false;
    // Handle letter-prefixed codes (e.g. L1-L50)
    const isLetterRange = cat.code_from.match(/^[A-Za-z]/);
    if (isLetterRange) {
      const prefix = cat.code_from.replace(/[0-9]/g, "");
      if (!code.startsWith(prefix)) return false;
      const num = parseInt(code.replace(prefix, ""), 10);
      const from = parseInt(cat.code_from.replace(prefix, ""), 10);
      const to = parseInt(cat.code_to.replace(prefix, ""), 10);
      return !isNaN(num) && num >= from && num <= to;
    }
    // Numeric codes
    const num = parseInt(code, 10);
    const from = parseInt(cat.code_from, 10);
    const to = parseInt(cat.code_to, 10);
    return !isNaN(num) && num >= from && num < to;
  };

  const addItemMutation = useMutation({
    mutationFn: async () => {
      let finalCode = newCode.trim();

      if (newOwnership === "rent") {
        // For rent items: validate 1-1000 and add Н prefix
        const num = parseInt(newCode);
        if (isNaN(num) || num < 1 || num > 1000) {
          throw new Error("За артикули под наем кодът трябва да е число между 1 и 1000");
        }
        finalCode = `Н${newCode.trim()}`;
      } else {
        // For milkos items: validate against category range
        if (!validateCodeInRange(newCode, newCategoryId)) {
          const cat = categories.find((c) => c.id === newCategoryId);
          throw new Error(`Кодът "${newCode}" не е в диапазона ${cat?.code_from}-${cat?.code_to} за категория "${cat?.name}"`);
        }
      }

      const price = parseFloat(newPrice);
      if (newPrice && isNaN(price)) throw new Error("Невалидна цена");
      const { error } = await supabase.from("inventory_items").insert({
        inventory_code: finalCode,
        category_id: newCategoryId,
        price: price || 0,
        notes: newNotes.trim(),
        ownership: newOwnership,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулът е добавен!");
      setAddOpen(false);
      setNewCode(""); setNewCategoryId(""); setNewPrice(""); setNewNotes(""); setNewOwnership("milkos");
      queryClient.invalidateQueries({ queryKey: ["inventory_items_all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendToRepairMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ status: "in_repair" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулът е изпратен в ремонт");
      queryClient.invalidateQueries({ queryKey: ["inventory_items_all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repairMutation = useMutation({
    mutationFn: async () => {
      const cost = parseFloat(repairCost) || 0;
      const { error: rpcError } = await supabase.rpc("record_repair", {
        _item_id: selectedItemId,
        _cost: cost,
        _notes: repairNotes,
      });
      if (rpcError) throw rpcError;
      const { error } = await supabase
        .from("inventory_items")
        .update({ status: "in_stock" })
        .eq("id", selectedItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ремонтът е завършен, артикулът е върнат в склада!");
      setRepairOpen(false);
      setRepairCost(""); setRepairNotes("");
      queryClient.invalidateQueries({ queryKey: ["inventory_items_all"] });
      queryClient.invalidateQueries({ queryKey: ["inventory_repair_history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const writeOffMutation = useMutation({
    mutationFn: async () => {
      if (!writeOffReason) throw new Error("Моля, изберете причина за бракуване");
      if (writeOffReason === "Друго" && !writeOffNote.trim()) {
        throw new Error("Моля, опишете причината за бракуване");
      }

      // Get current item to archive the code
      const { data: item, error: fetchError } = await supabase
        .from("inventory_items")
        .select("inventory_code")
        .eq("id", selectedItemId)
        .single();

      if (fetchError) throw fetchError;

      // Generate archived code: originalCode_BRK_date
      const today = format(new Date(), "dd.MM.yyyy");
      const archivedCode = `${item.inventory_code}_BRK_${today}`;

      // Format reason: if "Друго", include the note
      const finalReason = writeOffReason === "Друго"
        ? `Друго: ${writeOffNote.trim()}`
        : writeOffReason;

      // Update with archived code and written_off status
      const { error } = await supabase
        .from("inventory_items")
        .update({
          inventory_code: archivedCode,
          status: "written_off",
          write_off_reason: finalReason,
          written_off_at: new Date().toISOString()
        })
        .eq("id", selectedItemId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулът е бракуван и архивиран! Кодът е освободен за повторна употреба.");
      setWriteOffOpen(false);
      setWriteOffReason("");
      setWriteOffNote("");
      queryClient.invalidateQueries({ queryKey: ["inventory_items_all"] });
      queryClient.invalidateQueries({ queryKey: ["item_history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      // Check if item has any movements
      const { data: movements, error: movError } = await supabase
        .from("movements")
        .select("id")
        .eq("item_id", itemId)
        .limit(1);

      if (movError) throw movError;

      if (movements && movements.length > 0) {
        throw new Error("Артикулът не може да бъде изтрит защото има история на движения (отдавания/връщания).\nАко искате да го премахнете от активния инвентар, използвайте бутона за бракуване.");
      }

      // Delete the item
      const { error } = await supabase
        .from("inventory_items")
        .delete()
        .eq("id", itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулът е изтрит успешно!");
      setDeleteItemId(null);
      queryClient.invalidateQueries({ queryKey: ["inventory_items_all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editItemMutation = useMutation({
    mutationFn: async () => {
      let newCode = editCode;

      // Handle ownership change
      if (editOriginalOwnership !== editOwnership) {
        if (editOriginalOwnership === "milkos" && editOwnership === "rent") {
          // Changing from Милкос to Наем - add Н prefix if not already there
          if (!editCode.startsWith("Н")) {
            newCode = `Н${editCode}`;
          }
        } else if (editOriginalOwnership === "rent" && editOwnership === "milkos") {
          // Changing from Наем to Милкос - remove Н prefix
          newCode = editCode.replace(/^Н/, "");
        }
      }

      const updateData: any = {
        price: editPrice === "" ? 0 : Number(editPrice),
        ownership: editOwnership,
        notes: editNotes.trim() || null,
      };

      // Update code if it changed
      if (newCode !== editCode) {
        updateData.inventory_code = newCode;
      }

      const { error } = await supabase
        .from("inventory_items")
        .update(updateData)
        .eq("id", editItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулът е редактиран успешно!");
      setEditOpen(false);
      setEditCode("");
      setEditPrice("");
      setEditOwnership("milkos");
      setEditOriginalOwnership("milkos");
      setEditNotes("");
      setEditItemId("");
      queryClient.invalidateQueries({ queryKey: ["inventory_items_all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const PAGE_SIZE = 25;

  const filteredItems = items.filter((item) => {
    // Filter by search query
    const matchesSearch = !searchQuery || item.inventory_code.toLowerCase() === searchQuery.toLowerCase().trim();

    // Filter by status
    let matchesStatus = true;
    if (statusFilter) {
      // If URL param status is set, filter by that specific status
      matchesStatus = item.status === statusFilter;
    } else {
      // Otherwise use the showWrittenOff checkbox logic
      matchesStatus = showWrittenOff ? item.status === "written_off" : item.status !== "written_off";
    }

    return matchesSearch && matchesStatus;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (!sortKey) return 0;
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "code": return dir * a.inventory_code.localeCompare(b.inventory_code, undefined, { numeric: true });
      case "category": return dir * (a.categories?.name ?? "").localeCompare(b.categories?.name ?? "");
      case "ownership": return dir * a.ownership.localeCompare(b.ownership);
      case "price": return dir * (Number(a.price) - Number(b.price));
      case "repairs": return dir * (a.repair_count - b.repair_count);
      case "totalRepair": return dir * (Number(a.total_repair_cost) - Number(b.total_repair_cost));
      case "status": return dir * a.status.localeCompare(b.status);
      default: return 0;
    }
  });

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const pagedItems = sortedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); setSortDir("asc"); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />;
  };

  const exportToExcel = () => {
    const data = sortedItems.map((item) => ({
      "Код": item.inventory_code,
      "Категория": item.categories?.name ?? "",
      "Собственост": item.ownership === "milkos" ? "Милкос" : "Наем",
      "Цена (€)": Number(item.price).toFixed(2),
      "Ремонти": item.repair_count,
      "Общ ремонт (€)": Number(item.total_repair_cost).toFixed(2),
      "Статус": statusLabels[item.status] ?? item.status,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Инвентар");
    XLSX.writeFile(wb, `Инвентар_${format(new Date(), "dd-MM-yyyy")}.xlsx`);
  };

  const ownershipLabels: Record<string, string> = {
    milkos: "Милкос",
    rent: "Наем",
  };

  const statusLabels: Record<string, string> = {
    in_stock: "В склада",
    assigned: "Отдаден",
    in_repair: "В ремонт",
    written_off: "Бракуван",
  };

  const statusColors: Record<string, string> = {
    in_stock: "bg-success/10 text-success border-success/20",
    assigned: "bg-primary/10 text-primary border-primary/20",
    in_repair: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    written_off: "bg-destructive/10 text-destructive border-destructive/20",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="text-center sm:text-left w-full sm:w-auto">
          <h1 className="text-2xl font-bold text-foreground">Инвентар</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredItems.length} артикула{searchQuery && ` (от ${items.length})`}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 w-full sm:w-auto">
          <CategoryManagerDialog categories={categories} />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 flex-1 sm:flex-initial">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Заприходи</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="[&>button:last-of-type]:hover:rotate-90 [&>button:last-of-type]:transition-transform [&>button:last-of-type]:duration-200">
              <DialogHeader>
                <DialogTitle>Заприхождаване на артикул</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Категория</Label>
                  <Select value={newCategoryId} onValueChange={setNewCategoryId}>
                    <SelectTrigger><SelectValue placeholder="Изберете категория" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.code_from}-{c.code_to})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Инвентарен код</Label>
                  <Input
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder={
                      newOwnership === "rent"
                        ? "напр. 1 (ще стане Н1)"
                        : newCategoryId && categories.length > 0
                          ? `напр. ${categories.find((c) => c.id === newCategoryId)?.code_from || "001"}`
                          : "напр. 001"
                    }
                  />
                  {newOwnership === "rent" && (
                    <p className="text-xs text-muted-foreground">
                      За артикули под наем въведете число от 1 до 1000. Автоматично ще се добави префикс "Н".
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Цена (€)</Label>
                  <Input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="0.00"
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Собственост</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ownership"
                        value="milkos"
                        checked={newOwnership === "milkos"}
                        onChange={() => setNewOwnership("milkos")}
                        className="accent-primary w-4 h-4"
                      />
                      <span className="text-sm">Милкос</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ownership"
                        value="rent"
                        checked={newOwnership === "rent"}
                        onChange={() => setNewOwnership("rent")}
                        className="accent-primary w-4 h-4"
                      />
                      <span className="text-sm">Наем</span>
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Забележка</Label>
                  <Textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Допълнителна информация..." />
                </div>
                <Button onClick={() => addItemMutation.mutate()} disabled={!newCode || !newCategoryId || addItemMutation.isPending} className="w-full">
                  {addItemMutation.isPending ? "Запазване..." : "Заприходи"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-1">
              <Select value={filterCategory} onValueChange={(v) => { setFilterCategory(v); setPage(0); }}>
                <SelectTrigger className="w-full sm:w-64" aria-label="Филтър по категория">
                  <SelectValue placeholder="Филтър по категория" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всички категории</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                  placeholder="Търсене по код..."
                  className="pl-9 pr-8 w-full sm:w-56"
                  aria-label="Търсене по инвентарен код"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); setPage(0); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Изчисти търсенето"
                  >
                    <X className="h-5 w-5" strokeWidth={2.5} />
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showWrittenOff}
                  onChange={(e) => { setShowWrittenOff(e.target.checked); setPage(0); }}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm">Покажи бракувани</span>
              </label>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={exportToExcel}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary/40 bg-muted/50 opacity-70 transition-all hover:opacity-100 hover:border-primary hover:bg-muted self-center sm:self-auto"
                  aria-label="Експорт в Excel"
                >
                  <img src={excelIcon} alt="Excel" className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Експорт в Excel</TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 cursor-pointer select-none" onClick={() => toggleSort("code")}>
                  <span className="inline-flex items-center gap-1">Код <SortIcon col="code" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("category")}>
                  <span className="inline-flex items-center gap-1">Категория <SortIcon col="category" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("ownership")}>
                  <span className="inline-flex items-center gap-1">Собственост <SortIcon col="ownership" /></span>
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("price")}>
                  <span className="inline-flex items-center gap-1 justify-end">Цена <SortIcon col="price" /></span>
                </TableHead>
                <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort("repairs")}>
                  <span className="inline-flex items-center gap-1 justify-center">Ремонти <SortIcon col="repairs" /></span>
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("totalRepair")}>
                  <span className="inline-flex items-center gap-1 justify-end">Общ ремонт <SortIcon col="totalRepair" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("status")}>
                  <span className="inline-flex items-center gap-1">Статус <SortIcon col="status" /></span>
                </TableHead>
                {isAdmin && <TableHead className="text-right">Действия</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8 text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    {searchQuery ? "Няма съвпадения" : "Няма артикули"}
                  </TableCell>
                </TableRow>
              )}
              {pagedItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <button
                      className="font-mono font-medium text-primary hover:underline cursor-pointer"
                      onClick={() => setHistoryItem({ id: item.id, code: item.inventory_code })}
                    >
                      {item.inventory_code}
                    </button>
                  </TableCell>
                  <TableCell>{item.categories?.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={item.ownership === "rent" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : ""}>
                      {ownershipLabels[item.ownership] ?? item.ownership}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{Number(item.price).toFixed(2)} €</TableCell>
                  <TableCell className="text-center">
                    {item.repair_count > 0 && repairsByItem[item.id]?.length ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help inline-flex items-center gap-1">{item.repair_count}<Info className="w-4 h-4 text-muted-foreground" /></span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="space-y-1 text-xs">
                            {repairsByItem[item.id].map((r, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-muted-foreground whitespace-nowrap">
                                  {format(new Date(r.created_at), "dd.MM.yyyy")}
                                </span>
                                <span>{Number(r.cost).toFixed(2)} €</span>
                                {r.notes && <span className="text-muted-foreground">— {r.notes}</span>}
                              </div>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      item.repair_count
                    )}
                  </TableCell>
                  <TableCell className="text-right">{Number(item.total_repair_cost).toFixed(2)} €</TableCell>
                  <TableCell>
                    {item.status === "assigned" && assignedTo[item.id] ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 cursor-help">
                            <Badge variant="outline" className={statusColors[item.status] ?? ""}>
                              {statusLabels[item.status]}
                            </Badge>
                            <Info className="w-4 h-4 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span className="text-xs">{assignedTo[item.id]}</span>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="outline" className={statusColors[item.status] ?? ""}>
                        {statusLabels[item.status] ?? item.status}
                      </Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setHistoryItem({ id: item.id, code: item.inventory_code })}
                          title="История"
                        >
                          <History className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditItemId(item.id);
                            setEditCode(item.inventory_code);
                            setEditPrice(String(item.price || ""));
                            setEditOwnership(item.ownership);
                            setEditOriginalOwnership(item.ownership);
                            setEditNotes(item.notes || "");
                            setEditOpen(true);
                          }}
                          title="Редакция"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {(item.status === "in_stock" || item.status === "assigned") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRepairConfirmId(item.id)}
                            title="Изпрати в ремонт"
                          >
                            <Wrench className="w-3.5 h-3.5 text-orange-400" />
                          </Button>
                        )}
                        {item.status === "in_repair" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setSelectedItemId(item.id); setRepairOpen(true); }}
                            title="Завърши ремонт"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-success" />
                          </Button>
                        )}
                        {item.status !== "written_off" && item.status !== "in_repair" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setSelectedItemId(item.id); setWriteOffOpen(true); }}
                            title="Бракуване"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteItemId(item.id)}
                          title="Изтриване"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {sortedItems.length} артикула • Страница {page + 1} от {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Назад
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}>
              Напред
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Complete repair dialog */}
      <Dialog open={repairOpen} onOpenChange={setRepairOpen}>
        <DialogContent className="[&>button:last-of-type]:hover:rotate-90 [&>button:last-of-type]:transition-transform [&>button:last-of-type]:duration-200">
          <DialogHeader><DialogTitle>Завършване на ремонт</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Цена на ремонт (€)</Label>
              <Input type="number" value={repairCost} onChange={(e) => setRepairCost(e.target.value)} placeholder="0.00" className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div className="space-y-2">
              <Label>Забележка за ремонта</Label>
              <Textarea value={repairNotes} onChange={(e) => setRepairNotes(e.target.value)} placeholder="Описание на ремонта..." />
            </div>
            <Button onClick={() => repairMutation.mutate()} disabled={repairMutation.isPending} className="w-full">
              {repairMutation.isPending ? "Запазване..." : "Завърши ремонт"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Write-off dialog */}
      <Dialog open={writeOffOpen} onOpenChange={(open) => {
        setWriteOffOpen(open);
        if (!open) {
          setWriteOffReason("");
          setWriteOffNote("");
        }
      }}>
        <DialogContent className="[&>button:last-of-type]:hover:rotate-90 [&>button:last-of-type]:transition-transform [&>button:last-of-type]:duration-200">
          <DialogHeader><DialogTitle>Бракуване на артикул</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Причина за бракуване</Label>
              <Select value={writeOffReason} onValueChange={setWriteOffReason}>
                <SelectTrigger><SelectValue placeholder="Изберете причина" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Амортизация">Амортизация</SelectItem>
                  <SelectItem value="Кражба">Кражба</SelectItem>
                  <SelectItem value="Счупване">Счупване</SelectItem>
                  <SelectItem value="Друго">Друго</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {writeOffReason === "Друго" && (
              <div className="space-y-2">
                <Label>Опишете причината</Label>
                <Textarea
                  value={writeOffNote}
                  onChange={(e) => setWriteOffNote(e.target.value)}
                  placeholder="Опишете причината за бракуване..."
                  rows={3}
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => {
                setWriteOffOpen(false);
                setWriteOffReason("");
                setWriteOffNote("");
              }}>
                Отказ
              </Button>
              <Button
                variant="destructive"
                onClick={() => writeOffMutation.mutate()}
                disabled={!writeOffReason || (writeOffReason === "Друго" && !writeOffNote.trim()) || writeOffMutation.isPending}
              >
                {writeOffMutation.isPending ? "Обработка..." : "Бракувай"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit item dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => {
        setEditOpen(open);
        if (!open) {
          setEditCode("");
          setEditPrice("");
          setEditOwnership("milkos");
          setEditOriginalOwnership("milkos");
          setEditNotes("");
          setEditItemId("");
        }
      }}>
        <DialogContent className="[&>button:last-of-type]:hover:rotate-90 [&>button:last-of-type]:transition-transform [&>button:last-of-type]:duration-200">
          <DialogHeader><DialogTitle>Редакция на артикул</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Инвентарен код</Label>
              <Input
                value={editCode}
                disabled
                className="bg-muted cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground">Кодът не може да се променя след създаване</p>
            </div>
            <div className="space-y-2">
              <Label>Цена (€)</Label>
              <Input
                type="number"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
                placeholder="0.00"
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="space-y-2">
              <Label>Собственост</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editOwnership"
                    value="milkos"
                    checked={editOwnership === "milkos"}
                    onChange={(e) => setEditOwnership(e.target.value as "milkos" | "rent")}
                    className="w-4 h-4"
                  />
                  <span>Милкос</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editOwnership"
                    value="rent"
                    checked={editOwnership === "rent"}
                    onChange={(e) => setEditOwnership(e.target.value as "milkos" | "rent")}
                    className="w-4 h-4"
                  />
                  <span>Наем</span>
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Забележка</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Допълнителна информация..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => {
                setEditOpen(false);
                setEditCode("");
                setEditPrice("");
                setEditOwnership("milkos");
                setEditNotes("");
                setEditItemId("");
              }}>
                Отказ
              </Button>
              <Button onClick={() => editItemMutation.mutate()} disabled={editItemMutation.isPending}>
                {editItemMutation.isPending ? "Обработка..." : "Запази"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send to repair confirmation */}
      <ConfirmDialog
        open={!!repairConfirmId}
        onOpenChange={(open) => !open && setRepairConfirmId(null)}
        title="Изпращане в ремонт"
        description="Да изпратя ли артикула за ремонт?"
        confirmLabel="Изпрати"
        variant="warning"
        loading={sendToRepairMutation.isPending}
        onConfirm={() => {
          if (repairConfirmId) {
            sendToRepairMutation.mutate(repairConfirmId, {
              onSuccess: () => setRepairConfirmId(null),
            });
          }
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteItemId}
        onOpenChange={(open) => !open && setDeleteItemId(null)}
        title="Изтриване на артикул"
        description={
          <>
            Сигурни ли сте, че искате да изтриете този артикул? Артикулът може да бъде изтрит само ако няма записани движения (отдавания/връщания).
            <br />
            Това действие е необратимо!
          </>
        }
        confirmLabel="Изтрий"
        variant="destructive"
        loading={deleteItemMutation.isPending}
        onConfirm={() => {
          if (deleteItemId) {
            deleteItemMutation.mutate(deleteItemId);
          }
        }}
      />

      {/* Item history dialog */}
      <ItemHistoryDialog
        itemId={historyItem?.id ?? ""}
        itemCode={historyItem?.code ?? ""}
        open={!!historyItem}
        onOpenChange={(open) => !open && setHistoryItem(null)}
      />
    </div>
  );
}
