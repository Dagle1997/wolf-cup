import { GhinClient } from '@spicygolf/ghin';

export const ghinClient =
  process.env['GHIN_USERNAME'] && process.env['GHIN_PASSWORD']
    ? new GhinClient({
        username: process.env['GHIN_USERNAME'],
        password: process.env['GHIN_PASSWORD'],
      })
    : null;
