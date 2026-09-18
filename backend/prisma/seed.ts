import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const money = (n: number) => Math.round(n * 100) / 100;

// Deterministic RNG so every fresh install gets the same curated demo.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260918);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const daysFromNow = (d: number) => { const t = new Date(); t.setDate(t.getDate() + d); return t; };
const daysAgo = (d: number, h = 10) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, Math.floor(rnd() * 50) + 5, 0, 0); return t; };

// ---------------------------------------------------------------------------
// 1) Staff — one login per role so buyers can demo RBAC in 30 seconds.
// ---------------------------------------------------------------------------
const STAFF = [
  { name: 'Pharmacy Admin', email: 'admin@pharmacy.local', password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!', role: 'ADMIN' as const },
  { name: 'Dr. Lisa Nguyen', email: 'pharmacist@pharmacy.local', password: 'Pharmacist123!', role: 'PHARMACIST' as const },
  { name: 'Marcus Bell', email: 'tech@pharmacy.local', password: 'Tech12345!', role: 'TECHNICIAN' as const },
  { name: 'Priya Sharma', email: 'cashier@pharmacy.local', password: 'Cashier123!', role: 'CASHIER' as const },
];

// ---------------------------------------------------------------------------
// 2) Suppliers.
// ---------------------------------------------------------------------------
const SUPPLIERS = [
  { name: 'AmeriCure Wholesale', contactName: 'Sales Desk', phone: '+1 (555) 010-2030', email: 'orders@americure.example', address: 'Philadelphia, PA' },
  { name: 'Atlantic Pharma Supply', contactName: 'Dana Whitfield', phone: '+1 (617) 555-0144', email: 'orders@atlanticpharma.example', address: 'Boston, MA' },
  { name: 'MedSource Distributors', contactName: 'Carlos Mendez', phone: '+1 (410) 555-0192', email: 'sales@medsource.example', address: 'Baltimore, MD' },
  { name: 'FirstAid Direct', contactName: 'Jenny Park', phone: '+1 (614) 555-0117', email: 'hello@firstaiddirect.example', address: 'Columbus, OH' },
];

// ---------------------------------------------------------------------------
// 3) Catalog — code, name, generic, brand, category, ndc, rx, price, qty,
//    low-stock threshold, expiry offset (days from today).
// ---------------------------------------------------------------------------
type Med = [string, string, string | null, string | null, string, string, 'RX' | 'OTC', number, number, number, number, number];
const CATALOG: Med[] = [
  ['MED-1001', 'Acetaminophen 500mg', 'Acetaminophen', 'Tylenol', 'Tablets', '50580-0449', 'OTC', 5.49, 120, 15, 640, 0],
  ['MED-1002', 'Amoxicillin 250mg', 'Amoxicillin', 'Amoxil', 'Capsules', '00904-0746', 'RX', 12.99, 45, 10, 400, 0],
  ['MED-1003', 'Loratadine 10mg', 'Loratadine', 'Claritin', 'Tablets', '41100-0424', 'OTC', 8.25, 8, 10, 640, 0],
  ['MED-1004', 'Ibuprofen 200mg', 'Ibuprofen', 'Advil', 'Tablets', '50580-0458', 'OTC', 6.75, 0, 12, 400, 0],
  ['MED-1005', 'Cetirizine 10mg (expired demo)', 'Cetirizine', 'Zyrtec', 'Tablets', '41100-0430', 'OTC', 7.99, 20, 10, -60, 0],
  ['MED-2001', 'Lisinopril 10mg', 'Lisinopril', 'Zestril', 'Tablets', '68180-0513', 'RX', 9.99, 140, 20, 640, 1],
  ['MED-2002', 'Metformin 500mg', 'Metformin', 'Glucophage', 'Tablets', '0378-0101', 'RX', 8.49, 160, 20, 700, 1],
  ['MED-2003', 'Atorvastatin 20mg', 'Atorvastatin', 'Lipitor', 'Tablets', '0071-0156', 'RX', 14.99, 120, 15, 610, 1],
  ['MED-2004', 'Amlodipine 5mg', 'Amlodipine', 'Norvasc', 'Tablets', '0069-1520', 'RX', 9.49, 110, 15, 580, 1],
  ['MED-2005', 'Levothyroxine 50mcg', 'Levothyroxine', 'Synthroid', 'Tablets', '0456-0970', 'RX', 12.49, 95, 12, 540, 1],
  ['MED-2006', 'Sertraline 50mg', 'Sertraline', 'Zoloft', 'Tablets', '0049-4960', 'RX', 13.99, 80, 12, 500, 2],
  ['MED-2007', 'Losartan 50mg', 'Losartan', 'Cozaar', 'Tablets', '0006-0952', 'RX', 11.49, 85, 12, 520, 2],
  ['MED-2008', 'Omeprazole 20mg', 'Omeprazole', 'Prilosec', 'Tablets', '0115-0674', 'OTC', 11.99, 150, 20, 660, 0],
  ['MED-2009', 'Aspirin 81mg', 'Aspirin', 'Bayer', 'Tablets', '0280-1201', 'OTC', 4.99, 200, 25, 720, 3],
  ['MED-2010', 'Naproxen 220mg', 'Naproxen', 'Aleve', 'Tablets', '0057-0204', 'OTC', 7.49, 130, 15, 600, 3],
  ['MED-2011', 'Diphenhydramine 25mg', 'Diphenhydramine', 'Benadryl', 'Tablets', '0115-0502', 'OTC', 5.99, 90, 12, 560, 3],
  ['MED-2012', 'Famotidine 20mg', 'Famotidine', 'Pepcid', 'Tablets', '0006-0657', 'OTC', 8.99, 75, 10, 480, 1],
  ['MED-2013', 'Loperamide 2mg', 'Loperamide', 'Imodium', 'Capsules', '0057-0368', 'OTC', 6.49, 60, 10, 450, 1],
  ['MED-2014', 'Melatonin 5mg', 'Melatonin', 'Nature Made', 'Tablets', '0316-0228', 'OTC', 9.99, 110, 15, 690, 3],
  ['MED-2015', 'Azithromycin 250mg', 'Azithromycin', 'Zithromax', 'Tablets', '0069-3050', 'RX', 18.99, 7, 8, 400, 2],
  ['MED-2016', 'Doxycycline 100mg', 'Doxycycline', 'Vibramycin', 'Capsules', '0378-0621', 'RX', 15.49, 36, 8, 380, 2],
  ['MED-2017', 'Fluconazole 150mg', 'Fluconazole', 'Diflucan', 'Tablets', '0069-4190', 'RX', 16.99, 5, 6, 350, 2],
  ['MED-2018', 'Prednisone 10mg', 'Prednisone', 'Deltasone', 'Tablets', '0378-0211', 'RX', 10.99, 48, 8, 420, 2],
  ['MED-2019', 'Penicillin VK 500mg', 'Penicillin V', 'Veetids', 'Tablets', '0009-0177', 'RX', 12.99, 30, 8, 300, 2],
  ['MED-2020', 'Warfarin 5mg', 'Warfarin', 'Coumadin', 'Tablets', '0008-0565', 'RX', 11.99, 25, 6, 330, 2],
  ['MED-2021', 'Gabapentin 300mg', 'Gabapentin', 'Neurontin', 'Capsules', '0093-1042', 'RX', 13.49, 55, 10, 460, 2],
  ['MED-2022', 'Pantoprazole 40mg', 'Pantoprazole', 'Protonix', 'Tablets', '0037-4210', 'RX', 12.99, 70, 10, 490, 1],
  ['MED-2023', 'Tamsulosin 0.4mg', 'Tamsulosin', 'Flomax', 'Capsules', '0007-4902', 'RX', 15.99, 6, 6, 360, 2],
  ['MED-2024', 'Vitamin D3 1000IU', 'Cholecalciferol', 'Nature Made', 'Vitamins', '0316-0274', 'OTC', 8.49, 180, 20, 710, 3],
  ['MED-2025', 'Vitamin C 500mg', 'Ascorbic Acid', 'Emergen-C', 'Vitamins', '0415-0112', 'OTC', 7.99, 140, 15, 640, 3],
  ['MED-2026', 'Daily Multivitamin', 'Multivitamin', 'Centrum', 'Vitamins', '0168-0102', 'OTC', 12.99, 100, 12, 620, 3],
  ['MED-2027', 'Zinc 50mg', 'Zinc Gluconate', 'Cold-Eeze', 'Vitamins', '0415-0138', 'OTC', 6.99, 85, 10, 590, 3],
  ['MED-2028', 'Guaifenesin Syrup 100mg/5ml', 'Guaifenesin', 'Mucinex', 'Syrups', '0037-2210', 'OTC', 9.49, 65, 10, 420, 1],
  ['MED-2029', 'Dextromethorphan Syrup', 'Dextromethorphan', 'Delsym', 'Syrups', '0037-2230', 'OTC', 10.99, 58, 10, 400, 1],
  ['MED-2030', 'Amoxicillin Suspension 250mg/5ml', 'Amoxicillin', 'Amoxil', 'Syrups', '0093-4150', 'RX', 14.49, 32, 8, 280, 1],
  ['MED-2031', 'Hydrocortisone Cream 1%', 'Hydrocortisone', 'Cortizone-10', 'Topical', '0115-0812', 'OTC', 6.99, 70, 10, 520, 3],
  ['MED-2032', 'Triple Antibiotic Ointment', 'Bacitracin-Neomycin-Polymyxin', 'Neosporin', 'Topical', '0115-0904', 'OTC', 7.49, 66, 10, 500, 3],
  ['MED-2033', 'Clotrimazole Cream 1%', 'Clotrimazole', 'Lotrimin', 'Topical', '0115-0933', 'OTC', 8.49, 8, 8, 380, 3],
  ['MED-2034', 'Calamine Lotion', 'Calamine', 'Caladryl', 'Topical', '0115-0941', 'OTC', 5.49, 45, 8, 440, 3],
  ['MED-2035', 'Artificial Tears', 'Carboxymethylcellulose', 'Refresh', 'Drops', '0023-0880', 'OTC', 9.99, 52, 8, 460, 1],
  ['MED-2036', 'Saline Nasal Spray', 'Sodium Chloride', 'Ocean', 'Drops', '0115-0970', 'OTC', 4.49, 80, 10, 540, 1],
  ['MED-2037', 'Fluticasone Nasal Spray', 'Fluticasone', 'Flonase', 'Drops', '0173-0453', 'OTC', 13.99, 44, 8, 410, 1],
  ['MED-2038', 'Albuterol Inhaler 90mcg', 'Albuterol', 'ProAir', 'Inhalers', '0173-0682', 'RX', 34.99, 5, 6, 390, 2],
  ['MED-2039', 'Epinephrine Auto-Injector 0.3mg', 'Epinephrine', 'EpiPen', 'Injectables', '0009-0380', 'RX', 149.99, 6, 3, 320, 2],
  ['MED-2040', 'Insulin Glargine 100u/ml', 'Insulin Glargine', 'Lantus', 'Diabetes Care', '0088-5020', 'RX', 89.99, 4, 5, 300, 2],
  ['MED-2041', 'Glucose Tablets 4g', 'Dextrose', 'Dex4', 'Diabetes Care', '0415-0162', 'OTC', 5.99, 90, 12, 560, 3],
  ['MED-2042', 'Adhesive Bandages 100ct', null, 'Band-Aid', 'First Aid', '0115-0990', 'OTC', 6.29, 120, 15, 700, 3],
  ['MED-2043', 'Antiseptic Wipes 40ct', 'Benzalkonium Chloride', 'Dynarex', 'First Aid', '0115-0995', 'OTC', 4.79, 95, 12, 660, 3],
  ['MED-2044', 'Cough Drops Honey-Lemon', 'Menthol', 'Halls', 'Cough & Cold', '0115-1001', 'OTC', 3.99, 150, 20, 680, 3],
  ['MED-2045', 'Mupirocin Ointment 2%', 'Mupirocin', 'Bactroban', 'Topical', '0173-0479', 'RX', 19.99, 0, 5, 350, 2],
  ['MED-2046', 'Bismuth Subsalicylate 262mg (expired demo)', 'Bismuth Subsalicylate', 'Pepto-Bismol', 'Tablets', '0115-1010', 'OTC', 6.99, 14, 8, -45, 1],
  ['MED-2047', 'Amoxicillin 500mg (expires soon)', 'Amoxicillin', 'Amoxil', 'Capsules', '0093-2260', 'RX', 13.49, 26, 8, 30, 1],
];

// ---------------------------------------------------------------------------
// 4) Customers across the Eastern USA.
// ---------------------------------------------------------------------------
const CUSTOMERS = [
  { firstName: 'Emily', lastName: 'Carter', phone: '+1 (555) 201-8890', email: 'emily.carter@example.com', address: 'Boston, MA', insuranceProvider: 'BlueCross', allergies: 'Penicillin — rash', dateOfBirth: new Date('1988-04-12') },
  { firstName: 'James', lastName: 'Mitchell', phone: '+1 (555) 344-1120', email: null, address: 'Newark, NJ', insuranceProvider: null, allergies: null, dateOfBirth: null },
  { firstName: 'Robert', lastName: 'Hayes', phone: '+1 (215) 555-0163', email: 'robert.hayes@example.com', address: 'Philadelphia, PA', insuranceProvider: 'Aetna', allergies: 'Sulfa drugs — hives', dateOfBirth: new Date('1978-09-02') },
  { firstName: 'Maria', lastName: 'Santos', phone: '+1 (973) 555-0188', email: 'maria.santos@example.com', address: 'Newark, NJ', insuranceProvider: 'Cigna', allergies: 'Penicillin — anaphylaxis', dateOfBirth: new Date('1990-01-27') },
  { firstName: 'David', lastName: 'Kim', phone: '+1 (617) 555-0121', email: 'david.kim@example.com', address: 'Boston, MA', insuranceProvider: 'Medicare', allergies: null, dateOfBirth: new Date('1952-06-15') },
  { firstName: 'Sarah', lastName: "O'Connor", phone: '+1 (401) 555-0149', email: 'sarah.oconnor@example.com', address: 'Providence, RI', insuranceProvider: 'UnitedHealth', allergies: 'Aspirin — wheezing', dateOfBirth: new Date('1985-11-30') },
  { firstName: 'William', lastName: 'Thompson', phone: '+1 (410) 555-0172', email: 'william.t@example.com', address: 'Baltimore, MD', insuranceProvider: 'Medicare', allergies: 'None known', dateOfBirth: new Date('1948-03-08') },
  { firstName: 'Aisha', lastName: 'Khan', phone: '+1 (860) 555-0135', email: 'aisha.khan@example.com', address: 'Hartford, CT', insuranceProvider: 'Aetna', allergies: 'Latex', dateOfBirth: new Date('1995-07-19') },
  { firstName: 'Michael', lastName: 'Ross', phone: '+1 (412) 555-0119', email: null, address: 'Pittsburgh, PA', insuranceProvider: 'Medicaid', allergies: null, dateOfBirth: new Date('1971-12-03') },
  { firstName: 'Linda', lastName: 'Parker', phone: '+1 (804) 555-0156', email: 'linda.parker@example.com', address: 'Richmond, VA', insuranceProvider: 'Cigna', allergies: 'Codeine — nausea', dateOfBirth: new Date('1963-05-22') },
];

async function main() {
  // ---- staff (upsert by email) ----
  const staffIds: Record<string, string> = {};
  for (const s of STAFF) {
    const email = s.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { staffIds[s.role] = existing.id; continue; }
    const created = await prisma.user.create({
      data: { name: s.name, email, passwordHash: await bcrypt.hash(s.password, 12), role: s.role, active: true },
    });
    staffIds[s.role] = created.id;
    console.log(`Seeded user: ${email} / ${s.password} (${s.role})`);
  }
  const sellerId = staffIds['PHARMACIST'] ?? staffIds['ADMIN'];

  // ---- suppliers ----
  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({ where: { name: s.name } });
    if (existing) { supplierIds.push(existing.id); continue; }
    const created = await prisma.supplier.create({ data: s });
    supplierIds.push(created.id);
  }

  // ---- catalog (skip existing codes) ----
  let medsAdded = 0;
  for (const [code, name, generic, brand, category, ndc, rx, price, qty, thr, expDays, supIdx] of CATALOG) {
    const existing = await prisma.medicine.findUnique({ where: { code } });
    if (existing) continue;
    await prisma.medicine.create({
      data: {
        code, name, genericName: generic, brand, category, ndc, rxType: rx,
        unitPrice: price, quantity: qty, lowStockThreshold: thr,
        expiryDate: daysFromNow(expDays), supplierId: supplierIds[supIdx % supplierIds.length],
      },
    });
    await prisma.stockMovement.create({
      data: { medicineId: (await prisma.medicine.findUnique({ where: { code } }))!.id, changeQty: qty, reason: 'PURCHASE', note: 'Opening stock (seed)', createdById: sellerId, createdAt: daysAgo(30, 9) },
    });
    medsAdded++;
  }
  if (medsAdded) console.log(`Seeded ${medsAdded} medicines (+ opening stock ledger)`);

  // ---- customers (match by email, else name) ----
  const customerIds: string[] = [];
  for (const c of CUSTOMERS) {
    const existing = c.email
      ? await prisma.customer.findFirst({ where: { email: c.email } })
      : await prisma.customer.findFirst({ where: { firstName: c.firstName, lastName: c.lastName } });
    if (existing) { customerIds.push(existing.id); continue; }
    const created = await prisma.customer.create({ data: { ...c } });
    customerIds.push(created.id);
  }

  // ---- ledger backfill: every unit on hand must be traceable to a movement.
  // Older rows (first seed generation) predate opening-stock movements, so
  // insert the missing baseline once. Re-runs are no-ops (baseline = 0).
  const allMeds = await prisma.medicine.findMany({ select: { id: true, code: true, quantity: true } });
  let backfilled = 0;
  for (const m of allMeds) {
    const agg = await prisma.stockMovement.aggregate({ where: { medicineId: m.id }, _sum: { changeQty: true } });
    const baseline = m.quantity - (agg._sum.changeQty ?? 0);
    if (baseline !== 0) {
      await prisma.stockMovement.create({
        data: { medicineId: m.id, changeQty: baseline, reason: 'PURCHASE', note: 'Opening balance (seed backfill)', createdById: sellerId, createdAt: daysAgo(60, 9) },
      });
      backfilled++;
    }
  }
  if (backfilled) console.log(`Backfilled opening baseline for ${backfilled} medicine(s)`);

  // ---- 14-day sales history (skip if already seeded) ----
  const seeded = await prisma.sale.count({ where: { invoiceNo: { startsWith: 'INV-SEED-' } } });
  if (seeded === 0) {
    const meds = await prisma.medicine.findMany();
    const sellable = meds.filter((m) => !(m.expiryDate && m.expiryDate < new Date()) && m.quantity > 3);
    const byCode = new Map(meds.map((m) => [m.code, m]));
    // Weighted best-sellers so charts and top-seller lists look alive.
    const popular = ['MED-1001', 'MED-2003', 'MED-2002', 'MED-2024', 'MED-2009', 'MED-2008', 'MED-1002', 'MED-2025', 'MED-2004', 'MED-2005', 'MED-2044', 'MED-2010', 'MED-2042', 'MED-2014', 'MED-2026']
      .map((c) => byCode.get(c)).filter((m) => m && sellable.includes(m!)) as typeof meds;
    const pool = [...popular, ...popular, ...sellable];
    const stock = new Map(sellable.map((m) => [m.id, m.quantity]));
    let seq = 1;
    let salesMade = 0;
    const sales: { invoiceNo: string; customerId: string | null; lines: { medicineId: string; qty: number; unitPrice: number; lineTotal: number }[]; discountPct: number; taxPct: number; paymentMethod: 'CASH' | 'CARD' | 'INSURANCE'; date: Date; voided?: boolean; partialReturn?: { medicineId: string; qty: number } }[] = [];

    for (let day = 13; day >= 0; day--) {
      const nSales = 1 + Math.floor(rnd() * 3); // 1–3 sales/day
      for (let s = 0; s < nSales; s++) {
        const nLines = 1 + Math.floor(rnd() * 3);
        const lines: { medicineId: string; qty: number; unitPrice: number; lineTotal: number }[] = [];
        const used = new Set<string>();
        for (let l = 0; l < nLines; l++) {
          const m = pick(pool);
          if (used.has(m.id)) continue;
          const avail = stock.get(m.id) ?? 0;
          if (avail < 2) continue;
          used.add(m.id);
          const qty = 1 + Math.floor(rnd() * 2);
          const take = Math.min(qty, avail);
          const unit = Number(m.unitPrice);
          lines.push({ medicineId: m.id, qty: take, unitPrice: unit, lineTotal: money(unit * take) });
          stock.set(m.id, avail - take);
        }
        if (!lines.length) continue;
        sales.push({
          invoiceNo: `INV-SEED-${String(seq++).padStart(4, '0')}`,
          customerId: rnd() < 0.68 ? pick(customerIds) : null,
          lines,
          discountPct: pick([0, 0, 0, 0, 5, 10]),
          taxPct: 6,
          paymentMethod: pick(['CASH', 'CARD', 'CARD', 'INSURANCE', 'CASH']) as 'CASH' | 'CARD' | 'INSURANCE',
          date: daysAgo(day),
        });
      }
    }
    // Showcase rows: one voided sale + one partial return.
    if (sales[3]) sales[3].voided = true;
    const retTarget = sales.find((x) => !x.voided && x.lines.length >= 2);
    if (retTarget) retTarget.partialReturn = { medicineId: retTarget.lines[0].medicineId, qty: 1 };

    for (const s of sales) {
      const subtotal = money(s.lines.reduce((t, l) => t + l.lineTotal, 0));
      const discountAmt = money((subtotal * s.discountPct) / 100);
      const taxable = money(subtotal - discountAmt);
      const taxAmt = money((taxable * s.taxPct) / 100);
      const total = money(taxable + taxAmt);
      const created = await prisma.sale.create({
        data: {
          invoiceNo: s.invoiceNo, customerId: s.customerId, subtotal,
          discountPct: s.discountPct, discountAmt, taxPct: s.taxPct, taxAmt, total,
          paymentMethod: s.paymentMethod, status: s.voided ? 'VOIDED' : 'COMPLETED',
          soldById: sellerId, createdAt: s.date, items: { create: s.lines },
        },
      });
      for (const l of s.lines) {
        await prisma.stockMovement.create({
          data: { medicineId: l.medicineId, changeQty: -l.qty, reason: 'SALE', refId: created.id, note: s.invoiceNo, createdById: sellerId, createdAt: s.date },
        });
      }
      if (s.voided) {
        for (const l of s.lines) {
          await prisma.stockMovement.create({
            data: { medicineId: l.medicineId, changeQty: l.qty, reason: 'RETURN', refId: created.id, note: `Void ${s.invoiceNo} (seed)`, createdById: sellerId, createdAt: s.date },
          });
        }
      }
      if (s.partialReturn) {
        await prisma.stockMovement.create({
          data: { medicineId: s.partialReturn.medicineId, changeQty: s.partialReturn.qty, reason: 'RETURN', refId: created.id, note: `Unopened, patient request (${s.invoiceNo}, seed)`, createdById: sellerId, createdAt: s.date },
        });
      }
      salesMade++;
      // Apply net stock effect to the live rows.
      for (const l of s.lines) {
        const returned = s.voided ? l.qty : s.partialReturn?.medicineId === l.medicineId ? s.partialReturn.qty : 0;
        await prisma.medicine.update({ where: { id: l.medicineId }, data: { quantity: { increment: returned - l.qty } } });
      }
    }
    console.log(`Seeded ${salesMade} sales across 14 days (+ ledger, 1 void, 1 partial return)`);
  } else {
    console.log(`Sales history already seeded (${seeded} INV-SEED-* rows) — skipping`);
  }

  // ---- store settings (idempotent) ----
  const defaults: Record<string, string> = {
    'store.name': 'PharmaSuite Pharmacy',
    'store.tagline': 'Eastern USA · Rx + OTC',
    'store.address': 'Philadelphia, PA',
    'store.phone': '+1 (555) 010-2000',
    'store.receiptFooter': 'Thank you for your trust. Check expiry before use · Ask your pharmacist about interactions.',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log('Seeded store settings');

  const counts = await Promise.all([
    prisma.user.count(), prisma.medicine.count(), prisma.customer.count(),
    prisma.sale.count(), prisma.supplier.count(),
  ]);
  console.log(`Totals — users: ${counts[0]}, medicines: ${counts[1]}, customers: ${counts[2]}, sales: ${counts[3]}, suppliers: ${counts[4]}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
