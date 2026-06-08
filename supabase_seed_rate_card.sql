-- ═════════════════════════════════════════════════════════════════════
-- rate_card seed — GENERATED FILE, do not edit by hand.
-- Regenerate with: npm run generate-rate-card-seed
-- Source: src/lib/constants.ts (rate-bearing GC/Site Ops default lines)
-- Rows: 44 (all source='seed'; equals today's constants values)
-- ═════════════════════════════════════════════════════════════════════

INSERT INTO rate_card (template_name, line_code, rate, source) VALUES
  ('Company_Estimate_Template.xlsx', '01-0310.001', 175, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0320.001', 135, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0330.001', 120, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0340.001', 85, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0410.001', 125, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0420.001', 110, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0430.001', 85, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-0510.001', 55, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-1000.001', 500, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-1200.001', 1200, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-4010.001', 500, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5110.001', 9000, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5110.002', 850, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5111.001', 135, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5112.001', 250, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5114.001', 300, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5120.001', 800, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5150.001', 100, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5160.001', 1500, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5180.001', 900, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-5190.001', 650, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-6010.001', 350, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-6020.001', 250, 'seed'),
  ('Company_Estimate_Template.xlsx', '01-7010.001', 5000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-4100.001', 6, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9005.001', 2500, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9010.001', 74, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9010.002', 54, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9015.001', 500, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9020.001', 0.25, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9025.001', 5000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9030.001', 25, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9035.001', 15, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9040.001', 20, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9045.001', 5000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9050.001', 2000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9055.001', 1000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9060.001', 1000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9070.001', 400, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9307.001', 650, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9405.001', 6500, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9420.001', 2000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9425.001', 4000, 'seed'),
  ('Company_Estimate_Template.xlsx', '02-9430.001', 300, 'seed')
ON CONFLICT (template_name, line_code) DO NOTHING;
