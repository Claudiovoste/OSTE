import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    departure_id, tour, date_from, date_to,
    guests, name, email, phone, country, notes,
    total, deposit, balance,
    guests_data
  } = body;

  // ── Basic validation ────────────────────────────────────────────────────────
  if (!departure_id || !email || !name || !deposit || deposit < 100) {
    return json({ error: 'Missing required booking fields' }, 400);
  }

  // ── Check availability before charging ─────────────────────────────────────
  const { data: existing, error: countErr } = await supabase
    .from('bookings')
    .select('guests')
    .eq('departure_id', departure_id)
    .eq('status', 'confirmed');

  if (countErr) {
    console.error('Supabase availability check error:', countErr);
    return json({ error: 'Could not verify availability. Please try again.' }, 500);
  }

  const spotsTaken = (existing || []).reduce((sum, b) => sum + b.guests, 0);
  const spotsLeft  = 8 - spotsTaken;

  if (guests > spotsLeft) {
    return json({
      error: `Only ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} remaining for this departure.`
    }, 409);
  }

  // ── Create Stripe PaymentIntent ─────────────────────────────────────────────
  // Amount in cents; deposit is already in euros from the frontend
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(deposit * 100),
      currency: 'eur',
      receipt_email: email,
      metadata: {
        departure_id,
        tour,
        date_from,
        date_to,
        guests:  String(guests),
        name,
        email,
        balance: String(balance),
      },
      description: `OSTE · ${tour} · ${date_from} · ${guests} guest${guests > 1 ? 's' : ''} · Deposit`,
      // Save card for automatic balance charge 60 days before departure
      setup_future_usage: 'off_session',
    });
  } catch (err) {
    console.error('Stripe error:', err);
    return json({ error: err.message }, 500);
  }

  // ── Save booking to Supabase ────────────────────────────────────────────────
  const { error: insertErr } = await supabase
    .from('bookings')
    .insert({
      stripe_payment_intent_id: paymentIntent.id,
      departure_id,
      tour,
      date_from,
      date_to,
      guests,
      name,
      email,
      phone:    phone || null,
      country:  country || null,
      notes:    notes  || null,
      total,
      deposit,
      balance,
      status:   'confirmed',
      guests_data: guests_data || null,
    });

  if (insertErr) {
    // PaymentIntent was created — log this but still return clientSecret
    // so the customer can pay. You'll need to reconcile manually if this happens.
    console.error('Supabase insert error (PaymentIntent already created):', insertErr);
  }

  // ── Send confirmation email ─────────────────────────────────────────────────
  try {
    await resend.emails.send({
      from:    'OSTE Experiences <bookings@oste.it>',
      to:      email,
      replyTo: 'hello@oste.it',
      subject: `Your place is reserved — ${tour}, ${date_from}`,
      html:    confirmationEmailHtml({ name, tour, date_from, date_to, guests, deposit, balance, total }),
    });
  } catch (emailErr) {
    // Don't fail the booking if email fails — just log it
    console.error('Resend email error:', emailErr);
  }

  return json({ clientSecret: paymentIntent.client_secret });
};

// ── Email template ────────────────────────────────────────────────────────────
function confirmationEmailHtml({ name, tour, date_from, date_to, guests, deposit, balance, total }) {
  const firstName = name.split(' ')[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your OSTE booking</title>
  <style>
    body{margin:0;padding:0;background:#f0ece6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a0f0f}
    .wrap{max-width:560px;margin:40px auto;background:#faf8f5}
    .header{background:#1a0f0f;padding:40px 48px 32px}
    .logo{font-size:28px;font-weight:300;color:#ede9e4;letter-spacing:0.1em;margin:0}
    .header-sub{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c86b4a;margin:8px 0 0}
    .body{padding:40px 48px}
    h1{font-size:26px;font-weight:300;color:#4b1f1f;margin:0 0 8px}
    h1 em{font-style:italic;color:#7c5a42}
    p{font-size:14px;line-height:1.7;color:#7c5a42;margin:0 0 20px}
    .detail-box{background:#ede9e4;padding:24px 28px;margin:24px 0}
    .detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(124,90,66,0.12);font-size:13px}
    .detail-row:last-child{border-bottom:none}
    .detail-label{color:#7c5a42;opacity:0.7}
    .detail-value{color:#4b1f1f;font-weight:500}
    .highlight{background:#c86b4a;color:#faf8f5;padding:16px 28px;margin:24px 0;font-size:13px;line-height:1.6}
    .footer{background:#1a0f0f;padding:24px 48px;font-size:11px;color:rgba(237,233,228,0.35);line-height:1.8}
    .footer a{color:rgba(237,233,228,0.35)}
  </style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <p class="logo">OSTE</p>
    <p class="header-sub">Booking confirmation</p>
  </div>
  <div class="body">
    <h1>Your place is reserved,<br><em>${firstName}.</em></h1>
    <p>Thank you for booking with OSTE. Your deposit has been received and your place on this journey is confirmed.</p>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Journey</span><span class="detail-value">${tour}</span></div>
      <div class="detail-row"><span class="detail-label">Departure</span><span class="detail-value">${date_from}</span></div>
      <div class="detail-row"><span class="detail-label">Return</span><span class="detail-value">${date_to}</span></div>
      <div class="detail-row"><span class="detail-label">Guests</span><span class="detail-value">${guests}</span></div>
      <div class="detail-row"><span class="detail-label">Total</span><span class="detail-value">€${total.toLocaleString()}</span></div>
      <div class="detail-row"><span class="detail-label">Deposit paid today</span><span class="detail-value">€${deposit.toLocaleString()}</span></div>
      <div class="detail-row"><span class="detail-label">Balance due</span><span class="detail-value">€${balance.toLocaleString()}</span></div>
    </div>
    <div class="highlight">
      Your remaining balance of <strong>€${balance.toLocaleString()}</strong> will be charged automatically to your card <strong>60 days before departure</strong>. No action needed.
    </div>
    <p>We'll be in touch closer to your departure with full itinerary details, packing suggestions, and everything you need to know.</p>
    <p>Questions? Reply to this email or write to <a href="mailto:hello@oste.it" style="color:#c86b4a">hello@oste.it</a></p>
    <p style="margin-top:32px">A presto,<br><strong style="color:#4b1f1f">The OSTE team</strong></p>
  </div>
  <div class="footer">
    OSTE Experiences · Italy<br>
    <a href="https://oste.it/terms.html">Terms & conditions</a> · <a href="https://oste.it/privacy.html">Privacy policy</a>
  </div>
</div>
</body>
</html>`;
}

// ── Helper ────────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const config = { path: '/api/create-payment-intent' };
