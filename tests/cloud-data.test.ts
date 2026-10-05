import { removeUndefinedValues } from '../src/cloud-data.js'

const item = {
  id: 'tmdb-movie-1',
  releaseDate: undefined,
  providers: [{ name: 'Netflix', link: undefined }],
}
const saved = removeUndefinedValues(item)

if (Object.hasOwn(saved, 'releaseDate') || Object.hasOwn(saved.providers[0], 'link')) {
  throw new Error('Cloud data must not contain undefined fields.')
}
