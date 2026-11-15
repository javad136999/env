-- Additive schema for the environment reporting application.
-- Report data and identities are accessed only by the authenticated application server.
CREATE TABLE IF NOT EXISTS public.env_companies (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.env_accounts (
  open_id text PRIMARY KEY,
  name text,
  email text,
  role text NOT NULL DEFAULT 'pending' CHECK (role IN ('pending','company','admin')),
  company_id text REFERENCES public.env_companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_signed_in timestamptz,
  CHECK (role <> 'company' OR company_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.env_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL REFERENCES public.env_companies(id),
  year integer NOT NULL CHECK (year BETWEEN 1300 AND 1500),
  period integer NOT NULL CHECK (period IN (0,1,2)),
  category text NOT NULL CHECK (category IN ('water','waste','air','indicators')),
  values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(values) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  source_meta jsonb,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  CHECK ((category = 'indicators' AND period = 0) OR (category <> 'indicators' AND period IN (1,2))),
  UNIQUE (company_id,year,period,category)
);
CREATE TABLE IF NOT EXISTS public.env_report_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.env_reports(id),
  snapshot jsonb NOT NULL,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.env_raw_worksheets (
  spreadsheet_id text NOT NULL,
  spreadsheet_name text NOT NULL,
  sheet_id integer NOT NULL,
  sheet_name text NOT NULL,
  category text NOT NULL,
  company_label text,
  cells jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spreadsheet_id,sheet_id)
);
CREATE INDEX IF NOT EXISTS env_reports_company_year_idx ON public.env_reports(company_id,year,period);
CREATE INDEX IF NOT EXISTS env_report_history_report_idx ON public.env_report_history(report_id,changed_at);
ALTER TABLE public.env_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.env_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.env_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.env_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.env_raw_worksheets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.env_companies,public.env_accounts,public.env_reports,public.env_report_history,public.env_raw_worksheets FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.env_companies,public.env_accounts,public.env_reports,public.env_raw_worksheets TO service_role;
GRANT SELECT,INSERT ON public.env_report_history TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.env_report_history_id_seq TO service_role;
CREATE OR REPLACE FUNCTION public.env_audit_report_update() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.env_report_history(report_id,snapshot,changed_by)
    VALUES (OLD.id,to_jsonb(OLD),NEW.updated_by);
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS env_report_audit_update ON public.env_reports;
CREATE TRIGGER env_report_audit_update BEFORE UPDATE ON public.env_reports
  FOR EACH ROW EXECUTE FUNCTION public.env_audit_report_update();
