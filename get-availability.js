import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_SPOTS = 8;

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Get spots taken per departure (confirmed bookings only)
    const { data, error } = await supabase
      .from('bookings')
      .select('departure_id, guests')
      .eq('status', 'confirmed');

    if (error) throw error;

    // Aggregate spots taken per departure_id
    const taken = {};
    for (const row of data || []) {
      taken[row.departure_id] = (taken[row.departure_id] || 0) + row.guests;
    }

    // Convert to spots remaining
    const availability = {};
    for (const [id, spotsTaken] of Object.entries(taken)) {
      availability[id] = Math.max(0, MAX_SPOTS - spotsTaken);
    }

    return new Response(JSON.stringify({ availability }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Cache for 60 seconds — reduces DB calls, still feels live
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    console.error('get-availability error:', err);
    return new Response(JSON.stringify({ error: 'Could not load availability' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/get-availability' };
