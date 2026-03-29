/**
 * Cloudflare Pages Function Handler
 * 
 * This file handles all requests under the /pages prefix.
 * For SPA routing, we serve index.html for client-side routing.
 * 
 * IMPORTANT: This handler delegates to ASSETS binding which has
 * not_found_handling = "single-page-application" configured in wrangler.toml.
 * The ASSETS binding will automatically serve index.html for SPA routes.
 */

export interface Env {
  ASSETS: {
    fetch: typeof fetch;
  };
}

/**
 * Handle all requests for the SPA
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
      },
    });
  }

  // API routes are handled by Pages Functions in functions/api/
  // Cloudflare Pages automatically routes /api/* to functions/api/* handlers
  // We just need to pass through - the ASSETS binding serves static files only

  // For SPA routes and static assets, use ASSETS binding
  // which has not_found_handling = "single-page-application"
  if (env.ASSETS) {
    const response = await env.ASSETS.fetch(request);
    // Add CORS headers to the response
    const corsResponse = new Response(response.body, response);
    corsResponse.headers.set("Access-Control-Allow-Origin", "*");
    return corsResponse;
  }

  // Final fallback - should not reach here in production
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
};
