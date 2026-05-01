import { PrismaClient, AssignmentStatus, CustomerType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customers = [
    {
      accountNumber: '58392741',
      firstName: 'Maria',
      lastName: 'Santos',
      middleName: 'Lopez',
      contactNumber: '09171234567',
      email: 'maria.santos@example.com',
      addressLine1: 'Blk 12 Lot 5 San Isidro Village',
      barangay: 'San Isidro',
      city: 'Quezon City',
      province: 'Metro Manila',
      customerType: CustomerType.RESIDENTIAL,
    },
    {
      accountNumber: '76149028',
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      contactNumber: '09180000001',
      addressLine1: '45 Rizal Ave',
      barangay: 'Poblacion',
      city: 'Makati',
      province: 'Metro Manila',
      customerType: CustomerType.BUSINESS,
    },
    {
      accountNumber: '83476195',
      firstName: 'Angela',
      lastName: 'Reyes',
      contactNumber: '09180000002',
      email: 'a.reyes@example.com',
      addressLine1: 'Sunset Homes Phase 2',
      barangay: 'Talipapa',
      city: 'Caloocan',
      province: 'Metro Manila',
      customerType: CustomerType.RESIDENTIAL,
    },
    {
      accountNumber: '67921453',
      firstName: 'Kervin',
      lastName: 'Tan',
      contactNumber: '09180000003',
      email: 'kervin.tan@example.com',
      addressLine1: '8 Industrial Road',
      barangay: 'Bagumbayan',
      city: 'Taguig',
      province: 'Metro Manila',
      customerType: CustomerType.ENTERPRISE,
    },
    {
      accountNumber: '94573268',
      firstName: 'Liza',
      lastName: 'Garcia',
      contactNumber: '09180000004',
      addressLine1: '24 Maple St',
      barangay: 'Bahay Toro',
      city: 'Quezon City',
      province: 'Metro Manila',
      customerType: CustomerType.RESIDENTIAL,
    },
  ];

  for (const customer of customers) {
    const created = await prisma.customer.upsert({
      where: { accountNumber: customer.accountNumber },
      update: customer,
      create: customer,
    });

    const existingService = await prisma.customerService.findFirst({
      where: { customerId: created.id, planId: 'BASIC-50MBPS' },
    });

    if (!existingService) {
      await prisma.customerService.create({
        data: {
          customerId: created.id,
          planId: 'BASIC-50MBPS',
          serviceId: 'FIBER-INTERNET',
          startDate: new Date('2025-01-01T00:00:00Z'),
          status: AssignmentStatus.ACTIVE,
        },
      });
    }
  }

  console.log('Seed completed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
