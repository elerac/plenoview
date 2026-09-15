/** A linked program whose compiler work may still be running in the browser. */
export interface PendingProgram {
  /**
   * Returns null while compilation is pending. With KHR_parallel_shader_compile,
   * this does not wait for the driver. Without it, the first poll may block.
   * Throws when compilation fails or the handle has been disposed.
   */
  poll(): WebGLProgram | null;
  /** Deletes the owned program, including when compilation is still pending. */
  dispose(): void;
}

/**
 * Submit both shader stages and link before asking for any compilation status.
 * Checking COMPILE_STATUS or LINK_STATUS early can block Chrome's main thread
 * while ANGLE compiles the native GPU program.
 *
 * The handle owns the returned WebGLProgram until dispose() is called.
 */
export function createPendingProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): PendingProgram {
  const parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let ready = false;
  let disposed = false;
  let failure: Error | null = null;

  function deleteShaders(detach: boolean): void {
    for (const shader of [vertexShader, fragmentShader]) {
      if (shader) {
        if (detach && program) {
          gl.detachShader(program, shader);
        }
        gl.deleteShader(shader);
      }
    }
    vertexShader = null;
    fragmentShader = null;
  }

  function deleteResources(): void {
    if (program) {
      gl.deleteProgram(program);
      program = null;
    }
    deleteShaders(false);
  }

  try {
    vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) {
      throw new Error('Unable to create vertex shader object.');
    }
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);

    fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
      throw new Error('Unable to create fragment shader object.');
    }
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);

    program = gl.createProgram();
    if (!program) {
      throw new Error('Unable to create shader program.');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
  } catch (error) {
    deleteResources();
    throw error;
  }

  return {
    poll(): WebGLProgram | null {
      if (disposed) {
        throw new Error('Shader program has been disposed.');
      }
      if (failure) {
        throw failure;
      }
      // A program is retained until disposal or a recorded compilation failure.
      if (!program) {
        throw new Error('Shader program is unavailable.');
      }
      if (ready) {
        return program;
      }
      if (parallelCompile && !gl.getProgramParameter(program, parallelCompile.COMPLETION_STATUS_KHR)) {
        return null;
      }

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const errors: string[] = [];
        for (const [stage, shader] of [
          ['Vertex', vertexShader],
          ['Fragment', fragmentShader]
        ] as const) {
          if (shader && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            errors.push(`${stage} shader compile failed: ${gl.getShaderInfoLog(shader) || 'Unknown shader compile error.'}`);
          }
        }
        const linkLog = gl.getProgramInfoLog(program);
        if (linkLog || errors.length === 0) {
          errors.push(`Shader link failed: ${linkLog || 'Unknown shader link error.'}`);
        }
        failure = new Error(errors.join('\n'));
        deleteResources();
        throw failure;
      }

      ready = true;
      deleteShaders(true);
      return program;
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      deleteResources();
    }
  };
}
