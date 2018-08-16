import { doWhilst } from 'async-es';

import { normalizeBody, validationError } from './lib/api_utils';
import { Cipher, Folder } from './lib/models';
import { loadContextFromHeader, buildCipherDocument, touch } from './lib/bitwarden';

/**
 * @param {Object} model
 * @returns {Promise}
 */
const waitTillActive = async (model) => {
  let status = 'PENDING';
  return new Promise((resolve) => {
    doWhilst(
      (callback) => {
        model.describeTable((err, data) => {
          if (err) {
            return callback(err);
          }
          status = data.Table.TableStatus;
          setTimeout(callback, 1000);
          return null;
        });
      },
      () => status !== 'ACTIVE',
      resolve,
    );
  });
};

/**
 * @param {Number} writeUnits
 * @param {Object} table
 * @returns {Promise}
 */
const setCapacity = (writeUnits, table) =>
  new Promise((resolve) => {
    table.updateTable(
      { readCapacity: 1, writeCapacity: writeUnits },
      resolve,
    );
  }).then(() => waitTillActive(table));

export const postHandler = async (event, context, _callback) => {
  console.log('Bitwarden import handler triggered');

  const callback = (...params) => {
    // drop capacity back to 1
    Promise.all([
      setCapacity(1, Cipher),
      setCapacity(1, Folder),
    ]).then(() => {
      _callback(...params);
    });
  };

  /**
   * Data validation
   */

  let user;
  try {
    ({ user } = await loadContextFromHeader(event.headers.Authorization));
  } catch (e) {
    callback(null, validationError('User not found: ' + e.message));
    return;
  }

  if (!event.body) {
    callback(null, validationError('Request body is missing'));
    return;
  }

  const body = normalizeBody(JSON.parse(event.body));

  if (!Array.isArray(body.folders)) {
    callback(null, validationError('Folders is not an array'));
    return;
  } else if (!Array.isArray(body.ciphers)) {
    callback(null, validationError('Ciphers is not an array'));
    return;
  } else if (!Array.isArray(body.folderrelationships)) {
    callback(null, validationError('FolderRelationships is not an array'));
    return;
  }

  /**
   * Set write capacity temporarily
   */

  // set write capacity = n base units + 1 unit per 200 items
  const cipherWriteCapacity = 2 + Math.round(body.ciphers.length / 200);
  const folderWriteCapacity = 1 + Math.round(body.folders.length / 200);

  // Try to increase capacity
  await Promise.all([
    setCapacity(cipherWriteCapacity, Cipher),
    setCapacity(folderWriteCapacity, Folder),
  ]).then((err) => {
  // Log failure and continue
    console.log('Unknown error encountered while increasing capacity: ' + err);
  });

  /**
   * Folder creation
   */

  const folderPromises = body.folders.map(folder =>
    Folder.createAsync({
      name: folder.name,
      userUuid: user.get('uuid'),
    }));

  /**
   * Cipher creation
   */

  const cipherPromises = [];
  for (let i = 0; i < body.ciphers.length; i += 1) {
    const cipher = buildCipherDocument(body.ciphers[i], user);
    const destFolder = body.folderrelationships.filter(fr => fr.key === i);
    if (destFolder.length === 1) {
      const whichFolder = destFolder[0].value;
      if (folderPromises.length > whichFolder) {
        const folder = await folderPromises[whichFolder]; // eslint-disable-line
        cipher.folderUuid = folder.uuid;
      } else {
        callback(null, validationError('Folder defined in folder relationships was missing'));
        return;
      }
    }
    cipherPromises.push(Cipher.createAsync(cipher));
  }

  try {
    await Promise.all(folderPromises.concat(cipherPromises));
  } catch (e) {
    callback(null, validationError('Unable to create item: ' + e.message));
    return;
  }

  await touch(user);

  callback(null, {
    statusCode: 200,
    body: '',
  });
};
