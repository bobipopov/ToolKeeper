import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Info, Package, ShieldCheck, Users, Wrench } from "lucide-react";
import { format } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";
import excelIcon from "@/assets/excell.svg";

type InventoryItemWithCategory = Tables<"inventory_items"> & {
  categories: { name: string } | null;
};

type EmployeeMovement = Tables<"movements"> & {
  inventory_items: { inventory_code: string; price: number; categories: { name: string } | null } | null;
};

export default function Reports() {
  const [selectedEmployee, setSelectedEmployee] = useState("");

  // Sort state for stock items
  type StockSortKey = "code" | "category" | "price" | "notes";
  const [stockSortKey, setStockSortKey] = useState<StockSortKey | null>(null);
  const [stockSortDir, setStockSortDir] = useState<"asc" | "desc">("asc");

  // Sort state for repairs
  type RepairSortKey = "code" | "category" | "price" | "repairCount" | "totalCost" | "percent";
  const [repairSortKey, setRepairSortKey] = useState<RepairSortKey | null>(null);
  const [repairSortDir, setRepairSortDir] = useState<"asc" | "desc">("asc");

  // Sort state for responsibility
  type RespSortKey = "employee" | "totalItems" | "goodReturns" | "badReturns" | "damagePercent";
  const [respSortKey, setRespSortKey] = useState<RespSortKey | null>(null);
  const [respSortDir, setRespSortDir] = useState<"asc" | "desc">("asc");

  const toggleStockSort = (key: StockSortKey) => {
    if (stockSortKey === key) {
      if (stockSortDir === "asc") setStockSortDir("desc");
      else { setStockSortKey(null); setStockSortDir("asc"); }
    } else {
      setStockSortKey(key);
      setStockSortDir("asc");
    }
  };

  const toggleRepairSort = (key: RepairSortKey) => {
    if (repairSortKey === key) {
      if (repairSortDir === "asc") setRepairSortDir("desc");
      else { setRepairSortKey(null); setRepairSortDir("asc"); }
    } else {
      setRepairSortKey(key);
      setRepairSortDir("asc");
    }
  };

  const toggleRespSort = (key: RespSortKey) => {
    if (respSortKey === key) {
      if (respSortDir === "asc") setRespSortDir("desc");
      else { setRespSortKey(null); setRespSortDir("asc"); }
    } else {
      setRespSortKey(key);
      setRespSortDir("asc");
    }
  };

  const StockSortIcon = ({ col }: { col: StockSortKey }) => {
    if (stockSortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return stockSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />;
  };

  const RepairSortIcon = ({ col }: { col: RepairSortKey }) => {
    if (repairSortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return repairSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />;
  };

  const RespSortIcon = ({ col }: { col: RespSortKey }) => {
    if (respSortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return respSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />;
  };

  // Report 1: Repair cost vs item price
  const { data: repairReport = [], isPending: repairLoading } = useQuery({
    queryKey: ["report_repair"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*, categories(name)")
        .gt("repair_count", 0)
        .order("total_repair_cost", { ascending: false });
      if (error) throw error;
      return data as InventoryItemWithCategory[];
    },
  });

  // Repair history for tooltips (non-blocking: if RLS blocks, just skip tooltips)
  const { data: repairHistory = [] } = useQuery({
    queryKey: ["report_repair_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repair_history")
        .select("item_id, cost, notes, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("repair_history query failed (RLS?):", error.message);
        return [];
      }
      return data ?? [];
    },
    retry: false,
  });

  // Group repair history by item_id
  const repairsByItem = repairHistory.reduce<Record<string, typeof repairHistory>>((acc, r) => {
    if (!acc[r.item_id]) acc[r.item_id] = [];
    acc[r.item_id].push(r);
    return acc;
  }, {});

  // Report 2: Items assigned to an employee
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: employeeItems = [], isPending: empItemsLoading } = useQuery({
    queryKey: ["report_employee_items", selectedEmployee],
    queryFn: async () => {
      if (!selectedEmployee) return [];
      // Get all items currently assigned (status = 'assigned')
      // where the LAST movement for that item was an 'issue' to this employee
      const { data: assignedItems, error: assignedError } = await supabase
        .from("inventory_items")
        .select("id")
        .eq("status", "assigned");
      if (assignedError) throw assignedError;
      if (!assignedItems?.length) return [];

      const assignedIds = assignedItems.map((a) => a.id);

      // Use VIEW for automatic deduplication
      const { data: movements, error } = await supabase
        .from("latest_issue_movements")
        .select("*, inventory_items(inventory_code, price, categories(name))")
        .in("item_id", assignedIds)
        .eq("employee_id", selectedEmployee);
      if (error) throw error;

      return movements as EmployeeMovement[];
    },
    enabled: !!selectedEmployee,
  });

  // Report 3: Employee responsibility
  const { data: allEmployees = [] } = useQuery({
    queryKey: ["employees_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: responsibilityData, isPending: respLoading } = useQuery({
    queryKey: ["report_responsibility"],
    queryFn: async () => {
      // 1. Get all assigned items with prices
      const { data: assignedItems, error: aiErr } = await supabase
        .from("inventory_items")
        .select("id, price")
        .eq("status", "assigned");
      if (aiErr) throw aiErr;

      // 2. Get latest issue movements for assigned items to know who holds each
      let heldByEmployee: Record<string, { count: number; totalValue: number }> = {};
      if (assignedItems && assignedItems.length > 0) {
        const assignedIds = assignedItems.map((a) => a.id);
        const priceMap = Object.fromEntries(assignedItems.map((a) => [a.id, Number(a.price)]));
        // Use VIEW for automatic deduplication
        const { data: issueMovements } = await supabase
          .from("latest_issue_movements")
          .select("item_id, employee_id")
          .in("item_id", assignedIds);
        for (const m of issueMovements ?? []) {
          if (!heldByEmployee[m.employee_id]) heldByEmployee[m.employee_id] = { count: 0, totalValue: 0 };
          heldByEmployee[m.employee_id].count += 1;
          heldByEmployee[m.employee_id].totalValue += priceMap[m.item_id] ?? 0;
        }
      }

      // 3. Get ALL return movements to compute damage stats
      const { data: returns, error: retErr } = await supabase
        .from("movements")
        .select("employee_id, condition, created_at, inventory_items(inventory_code)")
        .eq("movement_type", "return")
        .order("created_at", { ascending: false });
      if (retErr) throw retErr;

      type BadReturn = { code: string; condition: string; date: string };
      const damageStats: Record<string, { totalReturns: number; badReturns: number; badDetails: BadReturn[] }> = {};
      for (const r of returns ?? []) {
        if (!damageStats[r.employee_id]) damageStats[r.employee_id] = { totalReturns: 0, badReturns: 0, badDetails: [] };
        damageStats[r.employee_id].totalReturns += 1;
        if (r.condition && r.condition !== "Без забележки") {
          damageStats[r.employee_id].badReturns += 1;
          damageStats[r.employee_id].badDetails.push({
            code: (r.inventory_items as { inventory_code: string } | null)?.inventory_code ?? "—",
            condition: r.condition,
            date: r.created_at,
          });
        }
      }

      return { heldByEmployee, damageStats };
    },
  });

  // Report 4: Items in stock
  const { data: stockItems = [], isPending: stockLoading } = useQuery({
    queryKey: ["report_stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*, categories(name)")
        .eq("status", "in_stock")
        .order("inventory_code");
      if (error) throw error;
      return data as InventoryItemWithCategory[];
    },
  });

  const sortedStockItems = [...stockItems].sort((a, b) => {
    if (!stockSortKey) return 0;
    const dir = stockSortDir === "asc" ? 1 : -1;
    switch (stockSortKey) {
      case "code": return dir * a.inventory_code.localeCompare(b.inventory_code, undefined, { numeric: true });
      case "category": return dir * (a.categories?.name ?? "").localeCompare(b.categories?.name ?? "");
      case "price": return dir * (Number(a.price) - Number(b.price));
      case "notes": return dir * (a.notes ?? "").localeCompare(b.notes ?? "");
      default: return 0;
    }
  });

  const sortedRepairReport = [...repairReport].sort((a, b) => {
    if (!repairSortKey) return 0;
    const dir = repairSortDir === "asc" ? 1 : -1;
    switch (repairSortKey) {
      case "code": return dir * a.inventory_code.localeCompare(b.inventory_code, undefined, { numeric: true });
      case "category": return dir * (a.categories?.name ?? "").localeCompare(b.categories?.name ?? "");
      case "price": return dir * (Number(a.price) - Number(b.price));
      case "repairCount": return dir * (a.repair_count - b.repair_count);
      case "totalCost": return dir * (Number(a.total_repair_cost) - Number(b.total_repair_cost));
      case "percent": {
        const pctA = a.price > 0 ? (a.total_repair_cost / a.price) * 100 : 0;
        const pctB = b.price > 0 ? (b.total_repair_cost / b.price) * 100 : 0;
        return dir * (pctA - pctB);
      }
      default: return 0;
    }
  });

  const sortedRespData = (responsibilityData && allEmployees) ? allEmployees
    .map((emp) => {
      const held = responsibilityData.heldByEmployee[emp.id];
      const dmg = responsibilityData.damageStats[emp.id];
      const itemCount = held?.count ?? 0;
      const totalValue = held?.totalValue ?? 0;
      const totalReturns = dmg?.totalReturns ?? 0;
      const badReturns = dmg?.badReturns ?? 0;

      // Skip employees with no activity
      if (itemCount === 0 && totalReturns === 0) return null;

      return {
        employeeId: emp.id,
        employee: emp.name,
        isActive: emp.is_active,
        totalItems: itemCount,
        totalValue: totalValue,
        damage: dmg,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => {
    if (!respSortKey) return 0;
    const dir = respSortDir === "asc" ? 1 : -1;
    switch (respSortKey) {
      case "employee": return dir * a.employee.localeCompare(b.employee);
      case "totalItems": return dir * (a.totalItems - b.totalItems);
      case "goodReturns": {
        const goodA = (a.damage?.totalReturns ?? 0) - (a.damage?.badReturns ?? 0);
        const goodB = (b.damage?.totalReturns ?? 0) - (b.damage?.badReturns ?? 0);
        return dir * (goodA - goodB);
      }
      case "badReturns": return dir * ((a.damage?.badReturns ?? 0) - (b.damage?.badReturns ?? 0));
      case "damagePercent": {
        const pctA = (a.damage?.totalReturns ?? 0) > 0 ? ((a.damage?.badReturns ?? 0) / a.damage!.totalReturns) * 100 : 0;
        const pctB = (b.damage?.totalReturns ?? 0) > 0 ? ((b.damage?.badReturns ?? 0) / b.damage!.totalReturns) * 100 : 0;
        return dir * (pctA - pctB);
      }
      default: return 0;
    }
  }) : [];

  const exportRepairsToExcel = () => {
    const data = sortedRepairReport.map((item) => {
      const pct = item.price > 0 ? (item.total_repair_cost / item.price) * 100 : 0;
      return {
        "Код": item.inventory_code,
        "Категория": item.categories?.name ?? "",
        "Цена артикул (€)": Number(item.price).toFixed(2),
        "Бр. ремонти": item.repair_count,
        "Общо ремонт (€)": Number(item.total_repair_cost).toFixed(2),
        "% от цена": (pct < 1 && pct > 0 ? pct.toFixed(1) : pct.toFixed(0)) + "%",
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ремонти");
    XLSX.writeFile(wb, `Ремонти_${format(new Date(), "dd-MM-yyyy")}.xlsx`);
  };

  const exportRespToExcel = () => {
    const data = sortedRespData.map((emp) => {
      const totalReturns = emp.damage?.totalReturns ?? 0;
      const badReturns = emp.damage?.badReturns ?? 0;
      const goodReturns = totalReturns - badReturns;
      const dmgPct = totalReturns > 0 ? (badReturns / totalReturns) * 100 : 0;
      return {
        "Служител": emp.employee,
        "Отдадени артикули": emp.totalItems,
        "Връщания без забележки": goodReturns,
        "Връщания със забележки": badReturns,
        "% повреди": dmgPct.toFixed(0) + "%",
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Отговорност");
    XLSX.writeFile(wb, `Отговорност_${format(new Date(), "dd-MM-yyyy")}.xlsx`);
  };

  const exportStockToExcel = () => {
    const data = sortedStockItems.map((item) => ({
      "Код": item.inventory_code,
      "Категория": item.categories?.name ?? "",
      "Цена (€)": Number(item.price).toFixed(2),
      "Забележка": item.notes || "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Наличност");
    XLSX.writeFile(wb, `Наличност_${format(new Date(), "dd-MM-yyyy")}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Справки</h1>
        <p className="text-sm text-muted-foreground mt-1">Отчети и анализи</p>
      </div>

      <Tabs defaultValue="stock" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="stock" className="gap-2"><Package className="w-3.5 h-3.5" />Наличност</TabsTrigger>
          <TabsTrigger value="employee" className="gap-2"><Users className="w-3.5 h-3.5" />Служител</TabsTrigger>
          <TabsTrigger value="repairs" className="gap-2"><Wrench className="w-3.5 h-3.5" />Ремонти</TabsTrigger>
          <TabsTrigger value="responsibility" className="gap-2"><ShieldCheck className="w-3.5 h-3.5" />Отговорност</TabsTrigger>
        </TabsList>

        {/* Report: Employee responsibility */}
        <TabsContent value="responsibility">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  Отговорност на служител
                </CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={exportRespToExcel}
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary/40 bg-muted/50 opacity-70 transition-all hover:opacity-100 hover:border-primary hover:bg-muted"
                      aria-label="Експорт в Excel"
                    >
                      <img src={excelIcon} alt="Excel" className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Експорт в Excel</TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleRespSort("employee")}>
                      <span className="inline-flex items-center gap-1">Служител <RespSortIcon col="employee" /></span>
                    </TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleRespSort("totalItems")}>
                      <span className="inline-flex items-center gap-1 justify-center">Артикули <RespSortIcon col="totalItems" /></span>
                    </TableHead>
                    <TableHead className="text-right">Обща стойност</TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleRespSort("goodReturns")}>
                      <span className="inline-flex items-center gap-1 justify-center">Връщания <RespSortIcon col="goodReturns" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleRespSort("badReturns")}>
                      <span className="inline-flex items-center gap-1 justify-center">Повреди <RespSortIcon col="badReturns" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleRespSort("damagePercent")}>
                      <span className="inline-flex items-center gap-1 justify-end">Коеф. повреди <RespSortIcon col="damagePercent" /></span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {respLoading && Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {!respLoading && sortedRespData.map((emp) => {
                    const totalReturns = emp.damage?.totalReturns ?? 0;
                    const badReturns = emp.damage?.badReturns ?? 0;
                    const goodReturns = totalReturns - badReturns;
                    const dmgPct = totalReturns > 0 ? (badReturns / totalReturns) * 100 : 0;

                    return (
                      <TableRow key={emp.employeeId}>
                        <TableCell className="font-medium">{emp.employee}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={emp.isActive ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground"}
                          >
                            {emp.isActive ? "Активен" : "Неактивен"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-medium">{emp.totalItems}</TableCell>
                        <TableCell className="text-right">
                          {emp.totalValue > 0 ? (
                            <span className="font-medium">{emp.totalValue.toFixed(2)} €</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{totalReturns || "—"}</TableCell>
                        <TableCell className="text-center">
                          {badReturns > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-destructive font-medium cursor-help inline-flex items-center gap-1">{badReturns}<Info className="w-4 h-4 text-muted-foreground" /></span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  {emp.damage!.badDetails.slice(0, 15).map((d, i) => (
                                    <div key={i} className="flex gap-2">
                                      <span className="text-muted-foreground whitespace-nowrap">
                                        {format(new Date(d.date), "dd.MM.yyyy")}
                                      </span>
                                      <span className="font-mono">{d.code}</span>
                                      <span className="text-destructive">{d.condition}</span>
                                    </div>
                                  ))}
                                  {emp.damage!.badDetails.length > 15 && (
                                    <div className="text-muted-foreground">...и още {emp.damage!.badDetails.length - 15}</div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {totalReturns > 0 ? (
                            <Badge
                              variant="outline"
                              className={
                                dmgPct > 50 ? "bg-destructive/10 text-destructive border-destructive/20"
                                : dmgPct > 20 ? "bg-primary/10 text-primary border-primary/20"
                                : ""
                              }
                            >
                              {dmgPct.toFixed(0)}%
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!respLoading && allEmployees.every((emp) => {
                    const held = responsibilityData?.heldByEmployee[emp.id];
                    const dmg = responsibilityData?.damageStats[emp.id];
                    return (held?.count ?? 0) === 0 && (dmg?.totalReturns ?? 0) === 0;
                  }) && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Няма данни</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Report 1: Repair cost/count vs Price */}
        <TabsContent value="repairs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Ремонт цена/бр vs Цена на артикула
                </CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={exportRepairsToExcel}
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary/40 bg-muted/50 opacity-70 transition-all hover:opacity-100 hover:border-primary hover:bg-muted"
                      aria-label="Експорт в Excel"
                    >
                      <img src={excelIcon} alt="Excel" className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Експорт в Excel</TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleRepairSort("code")}>
                      <span className="inline-flex items-center gap-1">Код <RepairSortIcon col="code" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleRepairSort("category")}>
                      <span className="inline-flex items-center gap-1">Категория <RepairSortIcon col="category" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleRepairSort("price")}>
                      <span className="inline-flex items-center gap-1 justify-end">Цена артикул <RepairSortIcon col="price" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleRepairSort("repairCount")}>
                      <span className="inline-flex items-center gap-1 justify-center">Бр. ремонти <RepairSortIcon col="repairCount" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleRepairSort("totalCost")}>
                      <span className="inline-flex items-center gap-1 justify-end">Общо ремонт <RepairSortIcon col="totalCost" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleRepairSort("percent")}>
                      <span className="inline-flex items-center gap-1 justify-end">% от цена <RepairSortIcon col="percent" /></span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repairLoading && Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {sortedRepairReport.map((item) => {
                    const pct = item.price > 0 ? (item.total_repair_cost / item.price) * 100 : 0;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono font-medium">{item.inventory_code}</TableCell>
                        <TableCell>{item.categories?.name}</TableCell>
                        <TableCell className="text-right">{Number(item.price).toFixed(2)} €</TableCell>
                        <TableCell className="text-center">
                          {repairsByItem[item.id]?.length ? (
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
                        <TableCell className="text-right">
                          <Badge variant="outline" className={pct > 100 ? "bg-destructive/10 text-destructive border-destructive/20" : pct > 50 ? "bg-primary/10 text-primary border-primary/20" : ""}>
                            {pct < 1 && pct > 0 ? pct.toFixed(1) : pct.toFixed(0)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!repairLoading && sortedRepairReport.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Няма данни за ремонти</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Report 2: Items per employee */}
        <TabsContent value="employee">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Налични артикули в служител</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Изберете служител" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedEmployee && empItemsLoading && (
                <div className="space-y-3 py-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              )}
              {selectedEmployee && !empItemsLoading && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Код</TableHead>
                      <TableHead>Категория</TableHead>
                      <TableHead className="text-right">Цена</TableHead>
                      <TableHead>Състояние</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employeeItems.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono">{m.inventory_items?.inventory_code}</TableCell>
                        <TableCell>{m.inventory_items?.categories?.name}</TableCell>
                        <TableCell className="text-right">{Number(m.inventory_items?.price ?? 0).toFixed(2)} €</TableCell>
                        <TableCell>
                          <Badge variant="outline">{m.condition}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                    }
                    {employeeItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          Няма отдадени артикули
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Report 3: Stock items */}
        <TabsContent value="stock">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" />
                  Налични артикули в склада ({sortedStockItems.length})
                </CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={exportStockToExcel}
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary/40 bg-muted/50 opacity-70 transition-all hover:opacity-100 hover:border-primary hover:bg-muted"
                      aria-label="Експорт в Excel"
                    >
                      <img src={excelIcon} alt="Excel" className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Експорт в Excel</TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleStockSort("code")}>
                      <span className="inline-flex items-center gap-1">Код <StockSortIcon col="code" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleStockSort("category")}>
                      <span className="inline-flex items-center gap-1">Категория <StockSortIcon col="category" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleStockSort("price")}>
                      <span className="inline-flex items-center gap-1 justify-end">Цена <StockSortIcon col="price" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleStockSort("notes")}>
                      <span className="inline-flex items-center gap-1">Забележка <StockSortIcon col="notes" /></span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockLoading && Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {sortedStockItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono font-medium">{item.inventory_code}</TableCell>
                      <TableCell>{item.categories?.name}</TableCell>
                      <TableCell className="text-right">{Number(item.price).toFixed(2)} €</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{item.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!stockLoading && sortedStockItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Складът е празен</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
