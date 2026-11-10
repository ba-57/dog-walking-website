import { addDays } from "./calendar.js";
// Explicit, read-only design preview. No Supabase connection, no writes, no real people.
export function createPreviewApi() {
  const today = new Date().toISOString().slice(0, 10);
  const slots = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 29].flatMap(
    (offset, i) =>
      [15, 16].map((hour) => {
        const day = addDays(today, offset);
        return {
          id: `sample-${i}-${hour}`,
          day,
          starts_at: `${day}T${hour}:00:00Z`,
          ends_at: `${day}T${hour}:30:00Z`,
          is_open: true,
        };
      }),
  );
  const readOnly = async () => {
    throw new Error(
      "This is a read-only design preview. Connect Supabase to make changes.",
    );
  };
  return {
    preview: true,
    calendar: async () => ({
      timezone: "UTC",
      today,
      last_date: addDays(today, 29),
      slots: slots.slice(1),
    }),
    session: async () => ({ user: { id: "sample-admin" } }),
    isAdmin: async () => true,
    onAuthChange: () => ({ unsubscribe() {} }),
    signOut: readOnly,
    signIn: readOnly,
    request: readOnly,
    addSlot: readOnly,
    setSlot: readOnly,
    blockDate: readOnly,
    review: readOnly,
    adminData: async () => ({
      slots,
      blocks: [{ day: addDays(today, 2) }],
      requests: [
        {
          id: "sample-request",
          slot_id: slots[0].id,
          customer_name: "Sample neighbor",
          email: "neighbor@example.test",
          phone: "(555) 010-0100",
          dog_name: "Sunny",
          neighborhood: "Example neighborhood",
          notes:
            "Fictional request for design review. Sunny likes a gentle pace.",
          status: "pending",
          created_at: new Date().toISOString(),
        },
      ],
    }),
  };
}
