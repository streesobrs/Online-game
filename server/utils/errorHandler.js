// 错误处理工具模块
const logger = require('./logger');

// 错误类型定义
const ErrorTypes = {
  AUTH_ERROR: 'AUTH_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

// 创建标准化错误响应
function createErrorResponse(type, message, details = null) {
  return {
    success: false,
    type: type,
    message: message,
    details: details,
    timestamp: Date.now()
  };
}

// 处理Socket事件错误
function handleSocketError(socket, eventName, err) {
  logger.error('Socket事件处理错误', {
    event: eventName,
    socketId: socket.id,
    error: err.message,
    stack: err.stack
  });

  // 根据错误类型返回适当的响应
  let response;
  if (err.type === ErrorTypes.AUTH_ERROR) {
    response = createErrorResponse(ErrorTypes.AUTH_ERROR, err.message);
  } else if (err.type === ErrorTypes.VALIDATION_ERROR) {
    response = createErrorResponse(ErrorTypes.VALIDATION_ERROR, err.message, err.details);
  } else if (err.type === ErrorTypes.NOT_FOUND) {
    response = createErrorResponse(ErrorTypes.NOT_FOUND, err.message);
  } else if (err.type === ErrorTypes.CONFLICT) {
    response = createErrorResponse(ErrorTypes.CONFLICT, err.message);
  } else {
    response = createErrorResponse(ErrorTypes.INTERNAL_ERROR, '服务器内部错误');
  }

  socket.emit('error', response);
}

// 处理HTTP错误
function handleHttpError(res, err) {
  logger.error('HTTP请求处理错误', {
    error: err.message,
    stack: err.stack
  });

  let statusCode = 500;
  let response;

  if (err.type === ErrorTypes.AUTH_ERROR) {
    statusCode = 401;
    response = createErrorResponse(ErrorTypes.AUTH_ERROR, err.message);
  } else if (err.type === ErrorTypes.VALIDATION_ERROR) {
    statusCode = 400;
    response = createErrorResponse(ErrorTypes.VALIDATION_ERROR, err.message, err.details);
  } else if (err.type === ErrorTypes.NOT_FOUND) {
    statusCode = 404;
    response = createErrorResponse(ErrorTypes.NOT_FOUND, err.message);
  } else if (err.type === ErrorTypes.CONFLICT) {
    statusCode = 409;
    response = createErrorResponse(ErrorTypes.CONFLICT, err.message);
  } else {
    response = createErrorResponse(ErrorTypes.INTERNAL_ERROR, '服务器内部错误');
  }

  res.status(statusCode).json(response);
}

// 创建特定类型的错误
function createError(type, message, details = null) {
  const error = new Error(message);
  error.type = type;
  error.details = details;
  return error;
}

// 验证错误
function validationError(message, details = null) {
  return createError(ErrorTypes.VALIDATION_ERROR, message, details);
}

// 认证错误
function authError(message) {
  return createError(ErrorTypes.AUTH_ERROR, message);
}

// 未找到错误
function notFoundError(message) {
  return createError(ErrorTypes.NOT_FOUND, message);
}

// 冲突错误
function conflictError(message) {
  return createError(ErrorTypes.CONFLICT, message);
}

// 数据库错误
function databaseError(message, details = null) {
  return createError(ErrorTypes.DATABASE_ERROR, message, details);
}

// 包装异步函数以统一处理错误
function asyncHandler(fn) {
  return function(...args) {
    return fn(...args).catch(err => {
      logger.error('异步操作未捕获错误', {
        error: err.message,
        stack: err.stack
      });
      throw err;
    });
  };
}

// Socket事件错误包装器
function socketEventHandler(handler) {
  return async function(socket, data, io) {
    try {
      return await handler(socket, data, io);
    } catch (err) {
      handleSocketError(socket, handler.name, err);
    }
  };
}

module.exports = {
  ErrorTypes,
  createErrorResponse,
  handleSocketError,
  handleHttpError,
  createError,
  validationError,
  authError,
  notFoundError,
  conflictError,
  databaseError,
  asyncHandler,
  socketEventHandler
};
