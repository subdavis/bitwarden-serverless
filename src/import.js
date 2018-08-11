import * as utils from './lib/api_utils';
import { Cipher } from './lib/models';
import { Folder } from './lib/models';
import { loadContextFromHeader, buildCipherDocument, touch } from './lib/bitwarden';

const MAX_RETRIES = 4;

/**
 * This callback type is `failureCallback`
 * @callback failureCallback
 * @param {Object} model - the model that failed to create
 * @param {Object} user - the user that owns this model
 * @returns {Promise}
 */

/**
 * resolveHandler resolves a promise list
 * @param {Promise} promiseList 
 * @param {failureCallback} fcb 
 * @returns {Object} - with members `output`, `failedPromises`
 */
const resolveHandler = async (promiseList, fcb) => {
  let retryCount = 0;
  let failedPromises = promiseList;
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
            const { model } = res;
            const retryPromise = new Promise((resolve) => {
              // Delay by 1-3s to get throughput lower
              // lambda has a limit of 30s for functions on API GWs
              setTimeout(resolve, Math.floor(Math.random() * 3000));
            }).then(() => {
              fcb(model, user);
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
  return {
    output,
    failedPromises
  };
}

export const postHandler = async (event, context, callback) => {
  console.log('Bitwarden import handler triggered');

  /**
   * Data validation
   */

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

  /**
   * Folder creation
   */

  if (!Array.isArray(body.folders)){
    callback(null, utils.validationError('Folders is not an array'));
    return;
  }

  let createFolder = (f, u) => {
    Folder
      .createAsync({
        name: f.name,
        userUuid: u.get('uuid'),
      })
      .then(result => ({ success: true, result, model: f }))
      .catch(error => ({ success: false, error, model: f }));
  }

  const folderPromises = body.folders.map(folder => {
    createFolder(folder, user)
  });

  let {
    output: folderOutput, 
    failedPromises: folderFailedPromises 
  } = await resolveHandler(folderPromises, createFolder);

  if (folderFailedPromises.length > 0) {
    folderOutput.push('Unable to complete for ' + folderFailedPromises.length + ' folders');
    callback(null, utils.validationError(folderOutput.join(' ')));
  }

  /**
   * Cipher creation
   */

  if (!Array.isArray(body.ciphers)) {
    callback(null, utils.validationError('Ciphers is not an array'));
    return;
  } else if (!Array.isArray(body.folderRelationships)) {
    callback(null, utils.validationError('FolderRelationships is not an array'));
    return;
  }

  func createCipher = (c, u) => {
    Cipher
      .createAsync(buildCipherDocument(c, u))
      .then(result => ({ success: true, result, model: c }))
      .catch(error => ({ success: false, error, model: c }));
  }

  const cipherPromises;
  for (let i = 0; i < body.ciphers.length; i += 1) {
    const cipher = buildCipherDocument(body.ciphers[i], user);
    const destFolder = body.folderRelationships.filter(fr => {
      return fr.key === i;
    });
    if (destFolder.length === 1) {
      if (folderPromises.length > i) {
        const {result: folder} = await folderPromises[i];
        cipher.folderUuid = folder.uuid;
      } else {
        callback(null, utils.validationError('Folder defined in folder relationships was missing'));
        return;
      }
    }
    createCipher(cipher, user);
  }

  let {
    output: cipherOutput, 
    failedPromises: cipherFailedPromises 
  } = await resolveHandler(cipherPromises, createCipher);

  if (cipherFailedPromises.length > 0) {
    cipherOutput.push('Unable to complete for ' + cipherFailedPromises.length + ' ciphers');
    callback(null, utils.validationError(cipherOutput.join(' ')));
  }

  await touch(user);

  callback(null, {
    statusCode: 201,
    body: cipherOutput.concat(folderOutput).join(' '),
  });
};
