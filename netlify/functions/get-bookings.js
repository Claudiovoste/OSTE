import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminKey = req.headers.get('x-admin-key');
  if (!adminKey || adminKey !== process.env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // ── Aggregate stats ───────────────────────────────────────────────────────
    const total_bookings        = bookings.length;
    const total_deposit_collected = bookings.reduce((s, b) => s + (b.deposit || 0), 0);
    const total_revenue         = bookings.reduce((s, b) => s + (b.total  || 0), 0);

    // Per-departure breakdown
    const byDepartureMap = {};
    for (const b of bookings) {
      if (!byDepartureMap[b.departure_id]) {
        byDepartureMap[b.departure_id] = { departure_id: b.departure_id, spots_taken: 0, total_revenue: 0 };
      }
      byDepartureMap[b.departure_id].spots_taken  += b.guests;
      byDepartureMap[b.departure_id].total_revenue += b.total;
    }
    const byDeparture = Object.values(byDepartureMap);

    // Format booked_at for display
    const formattedBookings = bookings.map(b => ({
      ...b,
      booked_at: new Date(b.created_at).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
    }));

    return new Response(JSON.stringify({
      total_bookings,
      total_deposit_collected,
      total_revenue,
      byDeparture,
      bookings: formattedBookings,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('get-bookings error:', err);
    return new Response(JSON.stringify({ error: 'Failed to load bookings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/get-bookings' };
