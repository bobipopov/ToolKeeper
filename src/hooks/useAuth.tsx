import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  role: "admin" | "user" | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredRole(): "admin" | "user" | null {
  return (localStorage.getItem("tk_role") as "admin" | "user") || null;
}

async function fetchRoleFromDB(userId: string): Promise<"admin" | "user"> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .abortSignal(controller.signal);
    clearTimeout(timer);
    if (error || !data || data.length === 0) {
      return getStoredRole() ?? "user";
    }
    const r: "admin" | "user" = data.some((d) => d.role === "admin") ? "admin" : "user";
    localStorage.setItem("tk_role", r);
    return r;
  } catch {
    return getStoredRole() ?? "user";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Role — reacts to user changes
  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    setRole(getStoredRole() ?? "user");
    let cancelled = false;
    fetchRoleFromDB(user.id).then((r) => {
      if (!cancelled) setRole(r);
    });

    // Update last activity when user is present
    supabase
      .rpc("update_last_activity")
      .then(() => {})
      .catch((err) => {
        console.warn("Failed to update last activity:", err);
      });

    return () => { cancelled = true; };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    // On success, onAuthStateChange fires and updates user/role
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    setUser(null);
    setRole(null);
    localStorage.removeItem("tk_role");
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    });
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("signOut timeout")), 3000),
      );
      await Promise.race([supabase.auth.signOut(), timeout]);
    } catch (err) {
      console.warn("signOut:", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, role, loading, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
