import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, ArrowLeft, Plus, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";

type InventoryItemWithCategory = Tables<"inventory_items"> & {
  categories: { name: string } | null;
};

type MovementWithRelations = Tables<"movements"> & {
  inventory_items: { id: string; inventory_code: string; categories: { name: string } | null } | null;
  employees: { name: string } | null;
};

interface CartItem {
  itemId: string;
  itemCode: string;
  categoryName: string;
  condition: string;
  consumableNote: string;
}

const CONDITIONS = ["Без забележки", "Захабено", "Счупено", "Пукнато"];

export default function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [movementType, setMovementType] = useState<"issue" | "return">("issue");

  // Issue state
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("Без забележки");
  const [consumableNote, setConsumableNote] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Return state
  const [returnEmployee, setReturnEmployee] = useState("");
  const [returnChecked, setReturnChecked] = useState<Record<string, boolean>>({});
  const [returnConditions, setReturnConditions] = useState<Record<string, string>>({});
  const [returnDamageNotes, setReturnDamageNotes] = useState<Record<string, string>>({});

  const { data: categories = [], isPending: categoriesLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("code_from");
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["inventory_items", selectedCategory],
    queryFn: async () => {
      let q = supabase.from("inventory_items").select("*, categories(name)").eq("status", "in_stock");
      if (selectedCategory && selectedCategory !== "all") q = q.eq("category_id", selectedCategory);
      const { data, error } = await q.order("inventory_code");
      if (error) throw error;
      return data as InventoryItemWithCategory[];
    },
  });

  const { data: employees = [], isPending: employeesLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  // Employee's assigned items (for return mode)
  const { data: employeeItems = [] } = useQuery({
    queryKey: ["employee_assigned_items", returnEmployee],
    queryFn: async () => {
      if (!returnEmployee) return [];

      // Get all issue movements for this employee
      const { data: movements, error } = await supabase
        .from("movements")
        .select("id, item_id, employee_id, movement_type, condition, created_at, inventory_items!inner(id, inventory_code, status, categories(name))")
        .eq("employee_id", returnEmployee)
        .eq("movement_type", "issue")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Client-side filtering and deduplication:
      // 1. Filter only items that are currently assigned
      // 2. Keep only latest movement per item
      const seen = new Set<string>();
      const deduplicated = (movements ?? [])
        .filter((m) => m.inventory_items?.status === "assigned")
        .filter((m) => {
          if (seen.has(m.item_id)) return false;
          seen.add(m.item_id);
          return true;
        });

      return deduplicated as MovementWithRelations[];
    },
    enabled: movementType === "return" && !!returnEmployee,
  });

  const { data: recentMovements = [], isPending: movementsLoading } = useQuery({
    queryKey: ["recent_movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movements")
        .select("*, inventory_items(inventory_code, categories(name)), employees(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as MovementWithRelations[];
    },
  });

  // Issue mutation
  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployee || cart.length === 0) throw new Error("Моля, добавете артикули и изберете служител");
      const movements = cart.map((c) => ({
        item_id: c.itemId,
        employee_id: selectedEmployee,
        movement_type: "issue" as const,
        condition: c.condition,
        consumable_note: c.consumableNote,
        issued_by: user?.id,
      }));
      const { error } = await supabase.from("movements").insert(movements);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулите са отдадени успешно!");
      setCart([]);
      setSelectedEmployee("");
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      queryClient.invalidateQueries({ queryKey: ["employee_assigned_items"] });
      queryClient.invalidateQueries({ queryKey: ["recent_movements"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Return mutation
  const returnMutation = useMutation({
    mutationFn: async () => {
      const checkedIds = Object.entries(returnChecked).filter(([, v]) => v).map(([k]) => k);
      if (!returnEmployee || checkedIds.length === 0) throw new Error("Моля, изберете артикули за приемане");
      const movements = checkedIds.map((itemId) => ({
        item_id: itemId,
        employee_id: returnEmployee,
        movement_type: "return" as const,
        condition: returnConditions[itemId] || "Без забележки",
        damage_notes: returnDamageNotes[itemId] || null,
        issued_by: user?.id,
      }));
      const { error } = await supabase.from("movements").insert(movements);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Артикулите са приети успешно!");
      setReturnChecked({});
      setReturnConditions({});
      setReturnDamageNotes({});
      setReturnEmployee("");
      queryClient.invalidateQueries({ queryKey: ["inventory_items"] });
      queryClient.invalidateQueries({ queryKey: ["employee_assigned_items"] });
      queryClient.invalidateQueries({ queryKey: ["recent_movements"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addToCart = () => {
    if (!selectedItem) return;
    const item = items.find((i) => i.id === selectedItem);
    if (!item) return;
    if (cart.find((c) => c.itemId === selectedItem)) {
      toast.error("Артикулът вече е добавен");
      return;
    }
    setCart([
      ...cart,
      {
        itemId: item.id,
        itemCode: item.inventory_code,
        categoryName: item.categories?.name ?? "",
        condition: selectedCondition,
        consumableNote: consumableNote,
      },
    ]);
    setSelectedItem("");
    setConsumableNote("");
    setSelectedCondition("Без забележки");
  };

  const checkedCount = Object.values(returnChecked).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Отдаване/Приемане</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Отдаване и приемане на инструменти • {format(new Date(), "dd.MM.yyyy")}
        </p>
      </div>

      {/* Movement type toggle */}
      <div className="flex gap-2 justify-center">
        <Button
          variant={movementType === "issue" ? "default" : "secondary"}
          onClick={() => { setMovementType("issue"); setCart([]); }}
          className="gap-2"
        >
          <ArrowRight className="w-4 h-4" />
          Отдаване
        </Button>
        <Button
          variant={movementType === "return" ? "default" : "secondary"}
          onClick={() => { setMovementType("return"); setCart([]); setReturnChecked({}); setReturnConditions({}); }}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Приемане
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {movementType === "issue" ? "Отдаване на инструменти" : "Приемане на инструменти"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(categoriesLoading || employeesLoading) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : movementType === "issue" ? (
              <>
                {/* === ISSUE FLOW (unchanged) === */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Категория</label>
                    <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); setSelectedItem(""); }}>
                      <SelectTrigger><SelectValue placeholder="Всички категории" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Всички категории</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({c.code_from}-{c.code_to})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Артикул</label>
                    <Select value={selectedItem} onValueChange={setSelectedItem}>
                      <SelectTrigger><SelectValue placeholder="Изберете артикул" /></SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.inventory_code} - {i.categories?.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Състояние</label>
                    <Select value={selectedCondition} onValueChange={setSelectedCondition}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Служител</label>
                    <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                      <SelectTrigger><SelectValue placeholder="Изберете служител" /></SelectTrigger>
                      <SelectContent>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Забележка / Консуматив</label>
                  <Textarea
                    value={consumableNote}
                    onChange={(e) => setConsumableNote(e.target.value)}
                    placeholder="Описание на консуматив или забележка..."
                    rows={2}
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={addToCart} variant="secondary" className="gap-2" disabled={!selectedItem}>
                    <Plus className="w-4 h-4" />
                    Добави в списък
                  </Button>
                </div>

                {cart.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Списък за отдаване ({cart.length} артикула)
                    </h3>
                    <div className="space-y-2">
                      {cart.map((c, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border/50">
                          <div className="flex items-center gap-3">
                            <Package className="w-4 h-4 text-primary" />
                            <div>
                              <span className="text-sm font-medium font-mono">{c.itemCode}</span>
                              <span className="text-sm text-muted-foreground ml-2">{c.categoryName}</span>
                            </div>
                            <Badge variant="outline" className="text-xs">{c.condition}</Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <Button
                      onClick={() => issueMutation.mutate()}
                      disabled={!selectedEmployee || issueMutation.isPending}
                      className="w-full mt-4 gap-2"
                    >
                      <ArrowRight className="w-4 h-4" />
                      {issueMutation.isPending ? "Обработка..." : `Отдай ${cart.length} артикула`}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* === RETURN FLOW === */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Служител</label>
                  <Select value={returnEmployee} onValueChange={(v) => { setReturnEmployee(v); setReturnChecked({}); setReturnConditions({}); }}>
                    <SelectTrigger className="w-64"><SelectValue placeholder="Изберете служител" /></SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {returnEmployee && employeeItems.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Този служител няма отдадени артикули
                  </p>
                )}

                {employeeItems.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Артикули в служителя ({employeeItems.length})
                    </h3>
                    <div className="space-y-2">
                      {employeeItems.map((m) => {
                        const itemId = m.inventory_items?.id ?? m.item_id;
                        const isChecked = !!returnChecked[itemId];
                        return (
                          <div
                            key={itemId}
                            className={`rounded-lg border transition-colors ${isChecked ? "bg-primary/5 border-primary/30" : "bg-secondary/50 border-border/50"}`}
                          >
                            <div className="flex items-center gap-3 p-3">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) =>
                                  setReturnChecked((prev) => ({ ...prev, [itemId]: !!checked }))
                                }
                              />
                              <Package className="w-4 h-4 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium font-mono">{m.inventory_items?.inventory_code}</span>
                                <span className="text-sm text-muted-foreground ml-2">{m.inventory_items?.categories?.name}</span>
                              </div>
                              <Select
                                value={returnConditions[itemId] || "Без забележки"}
                                onValueChange={(v) =>
                                  setReturnConditions((prev) => ({ ...prev, [itemId]: v }))
                                }
                              >
                                <SelectTrigger className="w-40 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CONDITIONS.map((c) => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {returnConditions[itemId] && returnConditions[itemId] !== "Без забележки" && (
                              <div className="px-3 pb-3 pt-0">
                                <Textarea
                                  placeholder="Детайлно описание на повредата..."
                                  value={returnDamageNotes[itemId] || ""}
                                  onChange={(e) =>
                                    setReturnDamageNotes((prev) => ({ ...prev, [itemId]: e.target.value }))
                                  }
                                  className="text-xs min-h-[60px]"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {checkedCount > 0 && (
                      <Button
                        onClick={() => returnMutation.mutate()}
                        disabled={returnMutation.isPending}
                        className="w-full mt-4 gap-2"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        {returnMutation.isPending ? "Обработка..." : `Приеми ${checkedCount} артикула`}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent movements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Последни 10 движения</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {movementsLoading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3 p-2">
                    <Skeleton className="w-4 h-4 mt-0.5 shrink-0 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))
              )}
              {!movementsLoading && recentMovements.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Няма движения</p>
              )}
              {recentMovements.map((m) => (
                <div key={m.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/30 transition-colors">
                  {m.movement_type === "issue" ? (
                    <ArrowRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  ) : (
                    <ArrowLeft className="w-4 h-4 text-success mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      <span className="font-mono">{m.inventory_items?.inventory_code ?? "—"}</span>
                      {" → "}
                      {m.employees?.name ?? <span className="italic text-muted-foreground">Изтрит служител</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(m.created_at), "dd.MM.yyyy HH:mm")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
