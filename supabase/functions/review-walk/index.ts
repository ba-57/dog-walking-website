import { createReviewHandler } from "../_shared/review-handler.js";
Deno.serve(createReviewHandler({ env: Deno.env }));
