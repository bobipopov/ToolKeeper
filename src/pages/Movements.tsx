import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Calendar, Search, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";
import excelIcon from "@/assets/excell.svg";

type MovementWithRelations = Tables<"movements"> & {
  inventory_items: { inventory_code: string; categories: { name: string } | null } | null;
  employees: { name: string } | null;
};

export default function Movements() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize from URL params or default to last 30 days
  const [dateFrom, setDateFrom] = useState(() => {
    const urlFrom = searchParams.get("from");
    if (urlFrom) return urlFrom;
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return format(date, "yyyy-MM-dd");
  });

  const [dateTo, setDateTo] = useState(() => {
    const urlTo = searchParams.get("to");
    if (urlTo) return urlTo;
    return format(new Date(), "yyyy-MM-dd");
  });

  const [selectedEmployee, setSelectedEmployee] = useState(searchParams.get("employee") || "all");
  const [movementType, setMovementType] = useState(searchParams.get("type") || "all");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 25;

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (selectedEmployee !== "all") params.set("employee", selectedEmployee);
    if (movementType !== "all") params.set("type", movementType);
    if (searchQuery) params.set("search", searchQuery);
    setSearchParams(params, { replace: true });
  }, [dateFrom, dateTo, selectedEmployee, movementType, searchQuery, setSearchParams]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [dateFrom, dateTo, selectedEmployee, movementType, searchQuery]);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: movements = [], isPending } = useQuery({
    queryKey: ["movements_filtered", dateFrom, dateTo, selectedEmployee, movementType, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from("movements")
        .select("*, inventory_items(inventory_code, categories(name)), employees(name)")
        .order("created_at", { ascending: false });

      // Date range filter
      if (dateFrom) {
        const fromDate = startOfDay(new Date(dateFrom));
        query = query.gte("created_at", fromDate.toISOString());
      }
      if (dateTo) {
        const toDate = endOfDay(new Date(dateTo));
        query = query.lte("created_at", toDate.toISOString());
      }

      // Employee filter
      if (selectedEmployee && selectedEmployee !== "all") {
        query = query.eq("employee_id", selectedEmployee);
      }

      // Movement type filter
      if (movementType && movementType !== "all") {
        query = query.eq("movement_type", movementType);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Client-side search filter (for inventory code)
      let filtered = data as MovementWithRelations[];
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (m) =>
            m.inventory_items?.inventory_code?.toLowerCase().includes(q) ||
            m.employees?.name?.toLowerCase().includes(q)
        );
      }

      return filtered;
    },
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(movements.length / PAGE_SIZE));
  const pagedMovements = movements.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportToExcel = () => {
    const data = movements.map((m) => ({
      Дата: format(new Date(m.created_at), "dd.MM.yyyy HH:mm"),
      Код: m.inventory_items?.inventory_code || "—",
      Категория: m.inventory_items?.categories?.name || "—",
      Служител: m.employees?.name || "Изтрит",
      Тип: m.movement_type === "issue" ? "Отдаване" : "Приемане",
      Състояние: m.condition || "—",
      Забележка: m.consumable_note || m.damage_notes || "—",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Движения");
    XLSX.writeFile(wb, `Движения_${format(new Date(), "dd-MM-yyyy")}.xlsx`);
  };

  const issueCount = movements.filter((m) => m.movement_type === "issue").length;
  const returnCount = movements.filter((m) => m.movement_type === "return").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            История на движенията
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {movements.length} движения • {issueCount} отдавания • {returnCount} приемания
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Date From */}
          <div className="space-y-2">
            <Label className="text-xs">От дата</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Date To */}
          <div className="space-y-2">
            <Label className="text-xs">До дата</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Employee Filter */}
          <div className="space-y-2">
            <Label className="text-xs">Служител</Label>
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всички</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Movement Type Filter */}
          <div className="space-y-2">
            <Label className="text-xs">Тип движение</Label>
            <Select value={movementType} onValueChange={setMovementType}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всички</SelectItem>
                <SelectItem value="issue">Отдаване</SelectItem>
                <SelectItem value="return">Приемане</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <Label className="text-xs">Търсене</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Код или име..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Quick date buttons */}
        <div className="flex gap-2 mt-4 pt-4 border-t">
          <button
            onClick={() => {
              const today = new Date();
              setDateFrom(format(today, "yyyy-MM-dd"));
              setDateTo(format(today, "yyyy-MM-dd"));
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
          >
            Днес
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const lastWeek = new Date();
              lastWeek.setDate(today.getDate() - 7);
              setDateFrom(format(lastWeek, "yyyy-MM-dd"));
              setDateTo(format(today, "yyyy-MM-dd"));
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
          >
            Последните 7 дни
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const lastMonth = new Date();
              lastMonth.setDate(today.getDate() - 30);
              setDateFrom(format(lastMonth, "yyyy-MM-dd"));
              setDateTo(format(today, "yyyy-MM-dd"));
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
          >
            Последните 30 дни
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
              setDateFrom(format(firstDay, "yyyy-MM-dd"));
              setDateTo(format(today, "yyyy-MM-dd"));
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
          >
            Този месец
          </button>
          <div className="flex-1" />
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

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата и час</TableHead>
                <TableHead>Артикул</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead>Служител</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Състояние</TableHead>
                <TableHead>Забележка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Зареждане...
                  </TableCell>
                </TableRow>
              )}
              {!isPending && pagedMovements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    {movements.length === 0 ? "Няма движения за избрания период" : "Няма резултати на тази страница"}
                  </TableCell>
                </TableRow>
              )}
              {pagedMovements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {format(new Date(m.created_at), "dd.MM.yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono">{m.inventory_items?.inventory_code || "—"}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.inventory_items?.categories?.name || "—"}
                  </TableCell>
                  <TableCell>
                    {m.employees?.name || <span className="italic text-muted-foreground">Изтрит</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {m.movement_type === "issue" ? (
                        <>
                          <ArrowRight className="w-4 h-4 text-primary" />
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                            Отдаване
                          </Badge>
                        </>
                      ) : (
                        <>
                          <ArrowLeft className="w-4 h-4 text-success" />
                          <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                            Приемане
                          </Badge>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.condition ? (
                      <Badge
                        variant="outline"
                        className={
                          m.condition === "Без забележки"
                            ? "bg-success/10 text-success border-success/20"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        }
                      >
                        {m.condition}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {m.consumable_note || m.damage_notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {movements.length} движения • Страница {page + 1} от {totalPages}
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
    </div>
  );
}
