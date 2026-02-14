import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowRight, ArrowLeft, Warehouse, Euro, TrendingUp } from "lucide-react";
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
