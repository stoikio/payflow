export type ErrorType =
  | 'authentication_error'
  | 'invalid_request_error'
  | 'rate_limit_error'
  | 'api_error';

export class ApiError extends Error {
  readonly status: 400 | 401 | 404 | 409 | 410 | 422 | 429 | 500;
  readonly type: ErrorType;
  readonly code: string;
  readonly param?: string;
  readonly extra: Record<string, unknown>;

  constructor(props: {
    status: ApiError['status'];
    type?: ErrorType;
    code: string;
    message: string;
    param?: string;
    extra?: Record<string, unknown>;
  }) {
    super(props.message);
    this.status = props.status;
    this.type = props.type ?? 'invalid_request_error';
    this.code = props.code;
    this.param = props.param;
    this.extra = props.extra ?? {};
  }

  toJSON() {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        param: this.param,
        ...this.extra,
      },
    };
  }
}

export const notFound = (resource: string, id: string) =>
  new ApiError({
    status: 404,
    code: 'resource_missing',
    message: `No such ${resource}: '${id}'`,
  });
