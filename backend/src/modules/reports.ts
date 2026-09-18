import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { requireAuth, requireRoles } from '../lib/auth.js';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/summary', { preHandler: [requireAuth] }, async () => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const fourteenAgo = new Date(now);
    fourteenAgo.setDate(fourteenAgo.getDate() - 13);

    const [
      medicineCount,
      customerCount,
      supplierCount,
      allMeds,
      expiredCount,
      salesAgg,
      todayAgg,
      recentSales,
      topItems,
      byCategory,
    ] = await Promise.all([
      prisma.medicine.count(),
      prisma.customer.count(),
      prisma.supplier.count(),
      prisma.medicine.findMany({ select: { quantity: true, lowStockThreshold: true, unitPrice: true } }),
      prisma.medicine.count({ where: { expiryDate: { lt: now } } }),
      prisma.sale.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.sale.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfDay } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.sale.findMany({
        where: { status: 'COMPLETED', createdAt: { gte: fourteenAgo } },
        select: { total: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 2000,
      }),
      prisma.saleItem.groupBy({
        by: ['medicineId'],
        _sum: { qty: true, lineTotal: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 8,
      }),
      prisma.medicine.groupBy({ by: ['category'], _count: { category: true } }),
    ]);

    const lowStockCount = allMeds.filter((m) => m.quantity <= m.lowStockThreshold).length;
    const outOfStockCount = allMeds.filter((m) => m.quantity === 0).length;
    const inventoryValue = allMeds.reduce((s, m) => s + m.quantity * Number(m.unitPrice), 0);

    const byDay = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(fourteenAgo);
      d.setDate(fourteenAgo.getDate() + i);
      byDay.set(d.toISOString().slice(0, 10), 0);
    }
    for (const s of recentSales) {
      const k = s.createdAt.toISOString().slice(0, 10);
      byDay.set(k, Math.round(((byDay.get(k) ?? 0) + Number(s.total)) * 100) / 100);
    }

    const medIds = topItems.map((t) => t.medicineId);
    const medNames = await prisma.medicine.findMany({ where: { id: { in: medIds } }, select: { id: true, name: true, code: true } });
    const nameById = new Map(medNames.map((m) => [m.id, m]));

    return {
      totals: {
        medicines: medicineCount,
        customers: customerCount,
        suppliers: supplierCount,
        lowStock: lowStockCount,
        outOfStock: outOfStockCount,
        expired: expiredCount,
        totalSales: salesAgg._count._all,
        revenue: Number(salesAgg._sum.total ?? 0),
        todaySales: todayAgg._count._all,
        todayRevenue: Number(todayAgg._sum.total ?? 0),
        inventoryValue: Math.round(inventoryValue * 100) / 100,
      },
      salesByDay: [...byDay.entries()].map(([date, revenue]) => ({ date, revenue })),
      topSellers: topItems.map((t) => ({
        medicineId: t.medicineId,
        name: nameById.get(t.medicineId)?.name ?? 'Unknown',
        code: nameById.get(t.medicineId)?.code ?? '',
        qty: t._sum.qty ?? 0,
        revenue: Number(t._sum.lineTotal ?? 0),
      })),
      stockByCategory: byCategory.map((c) => ({ category: c.category, count: c._count.category })),
    };
  });

  app.get('/audit-logs', { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 25) || 25));
    const [total, items] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  });
}
