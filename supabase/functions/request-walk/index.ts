import { createBookingHandler } from "../_shared/booking-handler.js";
Deno.serve(createBookingHandler({ env: Deno.env }));
