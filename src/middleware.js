/**
 * This is really only used for testing.
 *
 * @returns a guid-like string that might not be quite as random as a true guid
 */
/* eslint-disable */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
/* eslint-enable */

/**
* @typedef MiddlewareOptions
* @type {object}
* @property {bool} useChainOrder       Should chained functions be run in chain order (vs initial creation order). Default: TRUE
* @property {bool} useAsyncMiddleware  Should middleware functions be able to run asynchronously? Default: FALSE
*/
export const DEFAULT_OPTIONS = {
  useChainOrder: true,
  useAsyncMiddleware: true,
}

export class Middleware {
  constructor(fnsArray, globalOptions, inlineOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...globalOptions,
      ...inlineOptions,
    }
    this.run = []
    this.id = uuidv4()
    this.finish = function finish(finalFunc, finalFuncName) {
      // The run array may have null values depending on the chain & configured options.
      this.run = this.run.filter((fn) => !!fn)

      console.info('Finishing MW for id: ', this.id)
      console.info('  -  Functions to run:', this.run)
      const { id } = this

      return async (pReq, pRes) => {
        // If the passed response object is undefined we can
        // infer that this was called from a SSR route.
        const type = pRes ? 'api' : 'ssr'

        // in SSR the pReq will actually be the `context` object
        // containing both the `req` and `res` objects, so
        // `pRes` will be undefined.
        const res = {
          ...(pRes || pReq.res),
        }
        const req = {
          ...(pRes ? pReq : pReq.req),
          // Add a lib-specific decoration to the request
          _nmc: {
            id,
            name: finalFuncName,
            type,
          }
        }
        let runIndex = 0
        const RUNNER_STATES = {
          running: 'running',
          ended: 'ended',
          escaped: 'escaped',
          handled: 'handled',
          completed: 'completed',
        }
        let runnerState = RUNNER_STATES.running

        /**
         * This will handle state updates resulting from chain functions
         * and any pre-complete return values
         *
         * @param {*} arg
         * @param {*} payload
         * @returns
         */
        const runNext = (arg, payload) => {
          if (RUNNER_STATES.running) {
            switch (arg) {
            case 'route':
            case 'end':
              runnerState = RUNNER_STATES.ended

              return payload
            default:
              if (runIndex === this.run.length - 1) {
                runnerState = RUNNER_STATES.completed
              }

              return true
            }
          }

          return false
        }

        while (runnerState === RUNNER_STATES.running && runIndex < this.run.length) {
          let result

          if (!this.options.useAsyncMiddleware) {
            result = this.run[runIndex](req, res, runNext)
          }
          else {
            // eslint-disable-next-line no-await-in-loop
            result = await this.run[runIndex](req, res, runNext)
          }

          console.info(result)

          if (!result || (runnerState !== RUNNER_STATES.running && runnerState !== RUNNER_STATES.completed)) {
            runnerState = RUNNER_STATES.ended

            return result
          }

          runIndex += 1
        }

        console.info('Finished with function runner', this.id)

        if (runnerState === RUNNER_STATES.completed) {
          return type === 'api' ? finalFunc(req, res) : finalFunc({ req, res })
        }

        return undefined
      }
    }

    // this will be run when there is not current instance of
    // middleware for a given route
    fnsArray.forEach((fn, i) => {
      const fnName = fn.name

      this.run.push(null)

      // eslint-disable-next-line func-names
      this[fnName] = function() {
        console.info('options', this.options)
        if (this.options.useChainOrder) {
          this.run.push(fnsArray[i])
        }
        else {
          this.run[i] = fnsArray[i]
        }

        return this
      }
    })
  }
}
