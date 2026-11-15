export const strip = (item) =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([key]) =>
        ![
          "id",
          "version",
          "createdAt",
          "updatedAt",
          "completedAt",
          "cancelledAt",
          "classification",
        ].includes(key),
    ),
  );
