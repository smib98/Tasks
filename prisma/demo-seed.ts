import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysFromNow(days: number, hour = 17) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  const existingTasks = await prisma.task.count();
  if (existingTasks > 0 && process.env.NOTETASKS_DEMO_FORCE !== "1") {
    throw new Error(
      "The database is not empty. Use a fresh database for demo data, or set NOTETASKS_DEMO_FORCE=1 to replace it."
    );
  }

  if (existingTasks > 0) {
    await prisma.task.deleteMany();
  }

  await prisma.task.create({
    data: {
      title: "Prepare the quarterly planning brief",
      description: "Turn the team workshop notes into a concise plan with owners, milestones and open decisions.",
      category: "work",
      status: "active",
      priority: "High",
      estimatedMinutes: 90,
      deadline: daysFromNow(1),
      color: "yellow",
      createdBy: "Demo user",
      people: {
        create: [{ personName: "Product group" }, { personName: "Finance partner" }]
      },
      notes: {
        create: [{ type: "note", text: "Lead with the three decisions needed from the review.", createdBy: "Demo user" }]
      },
      subtasks: {
        create: [
          { title: "Summarise workshop themes", position: 0, completed: true, completedAt: new Date() },
          { title: "Confirm milestone owners", position: 1 },
          { title: "Share the review draft", position: 2 }
        ]
      },
      events: {
        create: [{ eventType: "created", summary: "Demo task created", createdBy: "Demo user" }]
      }
    }
  });

  await prisma.task.create({
    data: {
      title: "Review the mobile onboarding flow",
      description: "Walk through the latest prototype and capture the moments that need clearer guidance.",
      category: "work",
      status: "active",
      priority: "Medium",
      estimatedMinutes: 45,
      deadline: daysFromNow(3),
      color: "blue",
      createdBy: "Demo user",
      people: { create: [{ personName: "Design team" }] },
      notes: {
        create: [{ type: "note", text: "Check the empty state and first-run permissions copy.", createdBy: "Demo user" }]
      },
      events: {
        create: [{ eventType: "created", summary: "Demo task created", createdBy: "Demo user" }]
      }
    }
  });

  await prisma.task.create({
    data: {
      title: "Book an annual health check",
      description: "Choose a convenient morning appointment and add it to the calendar.",
      category: "personal",
      status: "active",
      priority: "Low",
      estimatedMinutes: 15,
      deadline: daysFromNow(6, 12),
      color: "green",
      createdBy: "Demo user",
      subtasks: {
        create: [
          { title: "Check available dates", position: 0 },
          { title: "Add appointment to calendar", position: 1 }
        ]
      },
      events: {
        create: [{ eventType: "created", summary: "Demo task created", createdBy: "Demo user" }]
      }
    }
  });

  await prisma.task.create({
    data: {
      title: "Draft the community newsletter",
      description: "Collect the highlights, upcoming dates and volunteer opportunities for this month.",
      category: "personal",
      status: "active",
      priority: "Medium",
      estimatedMinutes: 60,
      deadline: daysFromNow(8),
      color: "pink",
      createdBy: "Demo user",
      people: { create: [{ personName: "Volunteer group" }] },
      events: {
        create: [{ eventType: "created", summary: "Demo task created", createdBy: "Demo user" }]
      }
    }
  });

  await prisma.task.create({
    data: {
      title: "Reconcile travel expenses",
      description: "Match the receipts to the monthly statement and archive the completed report.",
      category: "work",
      status: "completed",
      priority: "Medium",
      estimatedMinutes: 30,
      deadline: daysFromNow(-1),
      completedAt: new Date(),
      color: "purple",
      createdBy: "Demo user",
      events: {
        create: [
          { eventType: "created", summary: "Demo task created", createdBy: "Demo user" },
          { eventType: "status", summary: "Task marked complete", newValue: "completed", createdBy: "Demo user" }
        ]
      }
    }
  });

  console.log("Added five generic demo tasks.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
