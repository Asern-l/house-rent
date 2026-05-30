/**
 * 文件说明：应用层统一错误响应辅助模块。
 * 目标：所有 HTTP 业务错误统一输出 { code, error, ...extra }。
 */

function error(code, message, extra = {}) {
  return { code, error: message, ...extra };
}

function sendError(res, status, code, message, extra = {}) {
  return res.status(status).json(error(code, message, extra));
}

class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function fail(status, code, message, extra = {}) {
  throw new AppError(status, code, message, extra);
}

function handleAppError(
  res,
  err,
  fallbackStatus = 500,
  fallbackCode = 'INTERNAL_ERROR',
  fallbackMessage = '服务器内部错误'
) {
  if (err instanceof AppError) {
    return sendError(res, err.status, err.code, err.message, err.extra);
  }
  return sendError(res, fallbackStatus, fallbackCode, fallbackMessage);
}

module.exports = {
  error,
  sendError,
  AppError,
  fail,
  handleAppError,
};
