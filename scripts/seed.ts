import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Bricks name -> ZenHR employment_number, for the employees whose name in
// Bricks (sales visits app) doesn't match their ZenHR name. Used in phase 2
// to link visits back to the right employee. Safe to seed now.
const NAME_OVERRIDES: { employmentNumber: string; bricksDisplayName: string }[] = [
  { employmentNumber: "115", bricksDisplayName: "Kareem Elsobky" }, // ZenHR: Karim Ahmed
  { employmentNumber: "104", bricksDisplayName: "Kareem Sherif" },
  { employmentNumber: "127", bricksDisplayName: "Kareim Helmy" },
  { employmentNumber: "135", bricksDisplayName: "Amgad" },
  { employmentNumber: "119", bricksDisplayName: "Mohamed Abdelrazek" },
  { employmentNumber: "136", bricksDisplayName: "Amr Mostafa" },
  { employmentNumber: "205", bricksDisplayName: "Safaa Sabry" },
  { employmentNumber: "212", bricksDisplayName: "Abdullah Ibrahim Habashi" },
];

async function main() {
  for (const override of NAME_OVERRIDES) {
    await prisma.employeeNameOverride.upsert({
      where: { employmentNumber: override.employmentNumber },
      create: override,
      update: override,
    });
  }
  console.log(`Seeded ${NAME_OVERRIDES.length} employee name overrides.`);

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.managerUser.upsert({
      where: { email: adminEmail.toLowerCase() },
      create: {
        email: adminEmail.toLowerCase(),
        passwordHash,
        name: "Admin",
        role: "ADMIN",
      },
      update: { passwordHash, role: "ADMIN" },
    });
    console.log(`Seeded admin user ${adminEmail}.`);
  } else {
    console.log(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set - skipped creating an admin user."
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
