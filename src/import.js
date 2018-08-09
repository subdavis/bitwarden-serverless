import * as utils from './lib/api_utils';
import { Cipher } from './lib/models';
import { loadContextFromHeader, buildCipherDocument, touch } from './lib/bitwarden';

const MAX_RETRIES = 4;

export const postHandler = async (event, context, callback) => {
  console.log('Bitwarden import handler triggered');

  let user;
  try {
    ({ user } = await loadContextFromHeader(event.headers.Authorization));
  } catch (e) {
    callback(null, utils.validationError('User not found: ' + e.message));
    return;
  }

  if (!event.body) {
    callback(null, utils.validationError('Request body is missing'));
    return;
  }

  const body = utils.normalizeBody(JSON.parse(event.body));

  if (typeof (body.ciphers) !== 'object') {
    callback(null, utils.validationError('Nothing to import'));
  }

  const savePromises = [];
  const output = [];

  for (let i = 0; i < body.ciphers.length; i += 1) {
    const rawCipher = body.ciphers[i];
    savePromises.push(Cipher.createAsync(buildCipherDocument(rawCipher, user))
      .then(result => ({ success: true, result, rawCipher }))
      .catch(error => ({ success: false, error, rawCipher })));
  }

  await touch(user);

  console.log('Waiting for imports to finish');

  let retryCount = 0;
  let failedPromises = savePromises;
  while (failedPromises.length > 0 && retryCount < MAX_RETRIES) {
    retryCount += 1;
    failedPromises = await Promise.all(failedPromises) // eslint-disable-line
      .then((results) => {
        const toRetry = [];
        for (let i = 0; i < results.length; i += 1) {
          const res = results[i];
          if (!res.success) {
            output.push('ERR: ' + res.code);
            console.error('ERR: ' + res.code);

            const { cipher } = res;
            const retryPromise = new Promise((resolve) => {
              // Delay by 1-30s to get throughput lower
              setTimeout(resolve, Math.floor(Math.random() * 30000));
            }).then(() => {
              Cipher.createAsync(buildCipherDocument(cipher, user))
                .then(result => ({ success: true, result, cipher }))
                .catch(error => ({ success: false, error, cipher }));
            });
            toRetry.push(retryPromise);
          }
        }

        const msg = 'DONE, total: ' + results.length + ', error: ' + toRetry.length + ', rounds: ' + retryCount;
        console.log(msg);
        output.push(msg);

        return toRetry;
      });

    console.log('Retrying ' + failedPromises + ' calls');
  }

  if (failedPromises.length > 0) {
    const msg = 'Unable to complete for ' + failedPromises.length + ' ciphers';
    console.log(msg);
    output.push(msg);
  }

  callback(null, {
    statusCode: 201,
    body: output.join(' '),
  });
};
