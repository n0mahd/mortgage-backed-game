'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.CORS_ORIGINS = 'https://mortgage.abdlh.com';

const request = require('supertest');

let app;

beforeAll(() => {
    ({ app } = require('../../server'));
});

afterAll(() => {
    delete process.env.CORS_ORIGINS;
});

describe('error responses never expose stacks or server paths', () => {
    test('a disallowed browser origin gets a short JSON 403', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Origin not allowed' });
    });

    test('the site origin is still allowed', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://mortgage.abdlh.com');
        expect(res.status).toBe(200);
    });

    test('malformed JSON bodies get a JSON 400', async () => {
        const res = await request(app)
            .post('/api/auth/anonymous')
            .set('Content-Type', 'application/json')
            .send('{"broken":');
        expect(res.status).toBe(400);
        expect(res.headers['content-type']).toMatch(/json/);
        expect(JSON.stringify(res.body)).not.toMatch(/node_modules|backend\/|\bat /);
    });
});
