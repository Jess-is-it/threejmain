import { PrismaClient } from '@prisma/client';
import { randomInt } from 'crypto';

const prisma = new PrismaClient();

function buildRandom8DigitAccountNumber() {
  const firstDigit = String(randomInt(1, 10));
  let accountNumber = firstDigit;
  for (let index = 0; index < 7; index += 1) {
    accountNumber += String(randomInt(0, 10));
  }
  return accountNumber;
}

function isAllowedAccountNumberPattern(value: string) {
  if (!/^[1-9][0-9]{7}$/.test(value)) {
    return false;
  }

  if (/^(\d)\1{7}$/.test(value)) {
    return false;
  }

  if (/^(\d)\1{3}(\d)\2{3}$/.test(value)) {
    return false;
  }

  if (/^(\d{2})\1{3}$/.test(value) || /^(\d{4})\1$/.test(value)) {
    return false;
  }

  const digits = value.split('').map((digit) => Number(digit));
  const isAscendingSequential = digits.every((digit, index) => index === 0 || digit - digits[index - 1] === 1);
  if (isAscendingSequential) {
    return false;
  }

  const isDescendingSequential = digits.every(
    (digit, index) => index === 0 || digit - digits[index - 1] === -1,
  );
  if (isDescendingSequential) {
    return false;
  }

  return true;
}

function generateUniqueAccountNumber(reserved: Set<string>) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = buildRandom8DigitAccountNumber();
    if (!isAllowedAccountNumberPattern(candidate)) {
      continue;
    }
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new Error('Unable to generate a unique secure account number');
}

async function main() {
  const customers = await prisma.customer.findMany({
    select: { id: true, accountNumber: true },
    orderBy: { createdAt: 'asc' },
  });

  const reserved = new Set<string>();
  const nextById = new Map<string, string>();
  for (const customer of customers) {
    nextById.set(customer.id, generateUniqueAccountNumber(reserved));
  }

  await prisma.$transaction(async (tx) => {
    for (const customer of customers) {
      const next = nextById.get(customer.id);
      if (!next) {
        continue;
      }
      await tx.customer.update({
        where: { id: customer.id },
        data: { accountNumber: next },
      });
    }
  });

  console.log(`Regenerated account numbers for ${customers.length} customer(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
