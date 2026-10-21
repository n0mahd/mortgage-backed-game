'use strict';

// Once JWT_SECRET_PREVIOUS is removed, old-secret tokens stop working.

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'new-secret';
delete process.env.JWT_SECRET_PREVIOUS;

const request = require('supertest');
const { createUserFixture, resetTestDb } = require('../helpers/fixtures');

let app, db;

beforeAll(() => {
    ({ app } = require('../../server'));
    db = require('../../db');
});

beforeEach(() => resetTestDb(db));

test('an old-secret token is refused after the rotation window closes', async () => {
    const user = createUserFixture(db, { anonymous: true });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(401);
});
