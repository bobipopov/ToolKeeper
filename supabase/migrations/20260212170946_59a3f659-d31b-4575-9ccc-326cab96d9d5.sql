
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Categories table
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code_from TEXT NOT NULL,
  code_to TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Employees (workers who receive tools)
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Inventory items
CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_code TEXT NOT NULL UNIQUE,
  category_id UUID NOT NULL REFERENCES public.categories(id),
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_stock',
  repair_count INTEGER NOT NULL DEFAULT 0,
  total_repair_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- Repair history
CREATE TABLE public.repair_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.repair_history ENABLE ROW LEVEL SECURITY;

-- Movements (tool issuance/return)
CREATE TABLE public.movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  movement_type TEXT NOT NULL, -- 'issue' or 'return'
  condition TEXT DEFAULT 'Без забележки',
  consumable_note TEXT DEFAULT '',
  issued_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  -- First user gets admin role, rest get user role
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS Policies

-- Profiles: authenticated can read all, update own
CREATE POLICY "Authenticated can read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- User roles: authenticated can read all
CREATE POLICY "Authenticated can read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Categories: authenticated can read, admins can manage
CREATE POLICY "Authenticated can read categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Employees: authenticated can read, admins can manage
CREATE POLICY "Authenticated can read employees" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert employees" ON public.employees FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update employees" ON public.employees FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete employees" ON public.employees FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Inventory items: authenticated can read, admins can manage, users can update status
CREATE POLICY "Authenticated can read items" ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert items" ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update items" ON public.inventory_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete items" ON public.inventory_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Repair history: authenticated can read, admins can manage
CREATE POLICY "Authenticated can read repairs" ON public.repair_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert repairs" ON public.repair_history FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update repairs" ON public.repair_history FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete repairs" ON public.repair_history FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Movements: authenticated can read and create, admins can manage all
CREATE POLICY "Authenticated can read movements" ON public.movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create movements" ON public.movements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can update movements" ON public.movements FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete movements" ON public.movements FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Update inventory status on movement
CREATE OR REPLACE FUNCTION public.handle_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'issue' THEN
    UPDATE public.inventory_items SET status = 'assigned' WHERE id = NEW.item_id;
  ELSIF NEW.movement_type = 'return' THEN
    UPDATE public.inventory_items SET status = 'in_stock' WHERE id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_movement_created
  AFTER INSERT ON public.movements
  FOR EACH ROW EXECUTE FUNCTION public.handle_movement();

-- Seed categories
INSERT INTO public.categories (name, code_from, code_to) VALUES
  ('Гайковерт', '001', '100'),
  ('Електрожен', '100', '200'),
  ('Ъглошлайф ф230', '200', '300'),
  ('Ъглошлайф ф125', '300', '400'),
  ('Дрелка', '400', '500'),
  ('Винтоверт', '500', '600'),
  ('Зеге', '600', '700'),
  ('Перфоратор', '700', '800'),
  ('Циркуляр', '800', '900'),
  ('Къртач', '900', '1000'),
  ('Лазерен нивелир', 'L1', 'L50');
