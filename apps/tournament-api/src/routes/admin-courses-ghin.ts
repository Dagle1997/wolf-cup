/**
 * GHIN course-import router — read-only discovery + mapping endpoints that
 * let an organizer pull any USGA-rated course straight from GHIN instead of
 * typing 18 holes × N tees by hand.
 *
 *   GET /api/admin/courses/ghin/search?q=<name>  — search the GHIN CRDB
 *   GET /api/admin/courses/ghin/:ghinCourseId    — fetch + map one course to
 *                                                  the POST /api/admin/courses
 *                                                  request shape (men's tees)
 *
 * These endpoints DO NOT persist. The web previews the mapped payload, lets
 * the organizer drop tees they don't want, then POSTs it to the existing
 * (battle-tested, validated, transactional) POST /api/admin/courses save
 * endpoint — so there's zero insert-logic duplication here.
 *
 * Auth: requireSession → requireOrganizer (organizer-only, like the rest of
 * /api/admin/courses). 503 service_unavailable when GHIN creds are unset
 * (ghinClient === null) — mirrors the players GHIN-lookup posture.
 */

import { Hono } from 'hono';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { ghinClient } from '../lib/ghin-client.js';
import { mapGhinCourseToSaveRequest } from '../lib/ghin-course-map.js';

export const adminCoursesGhinRouter = new Hono();

adminCoursesGhinRouter.use('/courses/ghin/*', requireSession);
adminCoursesGhinRouter.use('/courses/ghin/*', requireOrganizer);

const MIN_QUERY_LEN = 3;

adminCoursesGhinRouter.get('/courses/ghin/search', async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');
  const q = (c.req.query('q') ?? '').trim();

  if (q.length < MIN_QUERY_LEN) {
    return c.json(
      { error: 'bad_request', code: 'query_too_short', minLength: MIN_QUERY_LEN, requestId },
      400,
    );
  }
  if (!ghinClient) {
    return c.json({ error: 'service_unavailable', code: 'ghin_not_configured', requestId }, 503);
  }

  try {
    const results = await ghinClient.searchCourses(q);
    return c.json({ courses: results, requestId }, 200);
  } catch (err) {
    log?.error({ msg: 'ghin course search failed', requestId, q, err: String(err) });
    return c.json({ error: 'bad_gateway', code: 'ghin_unavailable', requestId }, 502);
  }
});

adminCoursesGhinRouter.get('/courses/ghin/:ghinCourseId', async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');
  const idRaw = c.req.param('ghinCourseId');
  const ghinCourseId = Number(idRaw);

  if (!Number.isInteger(ghinCourseId) || ghinCourseId <= 0) {
    return c.json({ error: 'bad_request', code: 'invalid_course_id', requestId }, 400);
  }
  if (!ghinClient) {
    return c.json({ error: 'service_unavailable', code: 'ghin_not_configured', requestId }, 503);
  }

  try {
    const details = await ghinClient.getCourseDetails(ghinCourseId);
    const mapped = mapGhinCourseToSaveRequest(details, { gender: 'Male' });
    if (!mapped.ok) {
      return c.json({ error: 'unprocessable', code: 'course_not_importable', reason: mapped.reason, requestId }, 422);
    }
    // Transparency: list every current tee (both genders) so the UI can show
    // what's available even though v1 imports the men's set.
    const availableTees = details.teeSets.map((t) => {
      const total = t.ratings.find((r) => r.type === 'Total');
      return {
        name: t.name,
        gender: t.gender,
        totalYardage: t.totalYardage,
        holes: t.holes.length,
        rating: total?.courseRating ?? null,
        slope: total?.slopeRating ?? null,
      };
    });
    return c.json(
      {
        ghinCourse: {
          id: details.ghinCourseId,
          name: details.name,
          city: details.city,
          state: details.state,
          facilityName: details.facilityName,
        },
        course: mapped.course,
        availableTees,
        requestId,
      },
      200,
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return c.json({ error: 'not_found', code: 'ghin_course_not_found', requestId }, 404);
    }
    log?.error({ msg: 'ghin course details failed', requestId, ghinCourseId, err: String(err) });
    return c.json({ error: 'bad_gateway', code: 'ghin_unavailable', requestId }, 502);
  }
});
