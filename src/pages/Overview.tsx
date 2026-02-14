import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowRight, ArrowLeft, Warehouse, Euro, TrendingUp, Users, AlertTriangle } from "lucide-react";
import { format, subDays, eachDayOfInterval } from "date-fns";

export default function Overview() {
  const navigate = useNavigate();

  // All items for status/value counts
  const { data: allItems = [] } = useQuery({
    queryKey: ["dashboard_all_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, status, price, ownership");
      if (error) throw error;
      return data;
    },
  });

  // Movements for last 30 days
  const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
  const { data: monthMovements = [] } = useQuery({
    queryKey: ["dashboard_month_movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movements")
        .select("id, movement_type, created_at")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // Top employees by assigned items
  const { data: topEmployees = [] } = useQuery({
    queryKey: ["dashboard_top_employees"],
    queryFn: async () => {
      const { data: movements, error } = await supabase
        .from("movements")
        .select("id, item_id, employee_id, movement_type, created_at, employees(name), inventory_items!inner(status)")
        .eq("movement_type", "issue")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Deduplicate and count items per employee
      const employeeCounts: Record<string, { name: string; count: number }> = {};
      const seenItems = new Set<string>();

      for (const m of movements || []) {
        if (m.inventory_items?.status !== "assigned") continue;
        if (seenItems.has(m.item_id)) continue;
        seenItems.add(m.item_id);

        const empId = m.employee_id;
        const empName = m.employees?.name || "Неизвестен";
        if (!employeeCounts[empId]) {
          employeeCounts[empId] = { name: empName, count: 0 };
        }
        employeeCounts[empId].count++;
      }

      return Object.entries(employeeCounts)
        .map(([id, data]) => ({ id, name: data.name, count: data.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    },
  });

  // Items with many repairs (alert)
  const { data: itemsWithManyRepairs = [] } = useQuery({
    queryKey: ["dashboard_items_many_repairs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, inventory_code, repair_count, total_repair_cost, categories(name)")
        .gte("repair_count", 2)
        .order("repair_count", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const statusCounts = useMemo(() => {
    const counts = { in_stock: 0, assigned: 0, in_repair: 0, written_off: 0 };
    for (const item of allItems) {
      if (item.status in counts) counts[item.status as keyof typeof counts]++;
    }
    return counts;
  }, [allItems]);

  const valueMetrics = useMemo(() => {
    let total = 0, milkos = 0, rent = 0;
    for (const item of allItems) {
      if (item.status === "written_off") continue;
      const price = Number(item.price);
      total += price;
      if (item.ownership === "milkos") milkos += price;
      else rent += price;
    }
    return { total, milkos, rent };
  }, [allItems]);

  const monthStats = useMemo(() => {
    let issues = 0, returns = 0;
    for (const m of monthMovements) {
      if (m.movement_type === "issue") issues++;
      else returns++;
    }
    return { issues, returns };
  }, [monthMovements]);

  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() });
    const byDay: Record<string, { issues: number; returns: number }> = {};
    for (const d of days) {
      byDay[format(d, "yyyy-MM-dd")] = { issues: 0, returns: 0 };
    }
    for (const m of monthMovements) {
      const key = format(new Date(m.created_at), "yyyy-MM-dd");
      if (byDay[key]) {
        if (m.movement_type === "issue") byDay[key].issues++;
        else byDay[key].returns++;
      }
    }
    return days.map((d) => {
      const key = format(d, "yyyy-MM-dd");
      return {
        date: format(d, "dd.MM"),
        fullDate: key,
        issues: byDay[key].issues,
        returns: byDay[key].returns
      };
    });
  }, [monthMovements]);

  const chartConfig = {
    issues: { label: "Отдавания", color: "hsl(38 92% 50%)" },
    returns: { label: "Връщания", color: "hsl(150 60% 40%)" },
  };

  const handleBarClick = (data: any) => {
    if (data && data.fullDate) {
      navigate(`/history?from=${data.fullDate}&to=${data.fullDate}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Табло</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Преглед на инвентара • {format(new Date(), "dd.MM.yyyy")}
        </p>
      </div>

      {/* Metrics cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Warehouse className="w-4 h-4" />
              Артикули по статус
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">В склада</span>
                <Badge variant="outline" className="bg-success/10 text-success border-success/20 font-mono">{statusCounts.in_stock}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Отдадени</span>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-mono">{statusCounts.assigned}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">В ремонт</span>
                <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/20 font-mono">{statusCounts.in_repair}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Бракувани</span>
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-mono">{statusCounts.written_off}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Euro className="w-4 h-4" />
              Стойност на инвентара
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{valueMetrics.total.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">€</span></p>
            <div className="flex gap-4 mt-2">
              <div>
                <span className="text-xs text-muted-foreground">Собствени</span>
                <p className="text-sm font-medium">{valueMetrics.milkos.toFixed(2)} €</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Наем</span>
                <p className="text-sm font-medium">{valueMetrics.rent.toFixed(2)} €</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Движения (30 дни)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div>
                <div className="flex items-center gap-2">
                  <ArrowRight className="w-4 h-4 text-primary" />
                  <span className="text-2xl font-bold">{monthStats.issues}</span>
                </div>
                <span className="text-xs text-muted-foreground">Отдавания</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4 text-success" />
                  <span className="text-2xl font-bold">{monthStats.returns}</span>
                </div>
                <span className="text-xs text-muted-foreground">Връщания</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Employees & Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Employees */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Топ 5 служители с най-много отдадени артикули
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topEmployees.length === 0 ? (
              <p className="text-xs text-muted-foreground">Няма отдадени артикули</p>
            ) : (
              <div className="space-y-2">
                {topEmployees.map((emp, idx) => (
                  <div key={emp.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0 text-xs font-mono">
                        {idx + 1}
                      </Badge>
                      <span className="text-sm">{emp.name}</span>
                    </div>
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-mono">
                      {emp.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Items with Many Repairs Alert */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Внимание: Артикули с много ремонти
            </CardTitle>
          </CardHeader>
          <CardContent>
            {itemsWithManyRepairs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Няма артикули с много ремонти</p>
            ) : (
              <div className="space-y-2">
                {itemsWithManyRepairs.slice(0, 5).map((item) => (
                  <Alert key={item.id} variant="destructive" className="py-2">
                    <AlertDescription className="text-xs flex items-center justify-between">
                      <div>
                        <span className="font-mono font-medium">{item.inventory_code}</span>
                        <span className="text-muted-foreground ml-2">{item.categories?.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                          {item.repair_count} ремонта
                        </Badge>
                        <span className="text-xs font-medium">{Number(item.total_repair_cost).toFixed(2)} €</span>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Movements chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Движения по дни (последните 30 дни)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Кликнете на ден за детайли</p>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 15% 20%)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="issues" fill="var(--color-issues)" radius={[3, 3, 0, 0]} onClick={handleBarClick} style={{ cursor: "pointer" }} />
              <Bar dataKey="returns" fill="var(--color-returns)" radius={[3, 3, 0, 0]} onClick={handleBarClick} style={{ cursor: "pointer" }} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
