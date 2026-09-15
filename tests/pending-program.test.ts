import { describe, expect, it, vi } from 'vitest';
import { createPendingProgram } from '../src/rendering/gl-image-renderer/pending-program';

describe('pending shader programs', () => {
  it('submits both stages and links without querying blocking status, then polls completion', () => {
    const { gl, program, completionStatus } = createHarness();
    const pending = createPendingProgram(gl, 'vertex source', 'fragment source');

    expect(gl.compileShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledWith(program);
    expect(gl.getProgramParameter).not.toHaveBeenCalled();
    expect(gl.getShaderParameter).not.toHaveBeenCalled();

    expect(pending.poll()).toBeNull();
    expect(gl.getProgramParameter.mock.calls).toEqual([[program, completionStatus]]);
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(gl.getShaderInfoLog).not.toHaveBeenCalled();
    expect(gl.getProgramInfoLog).not.toHaveBeenCalled();
    expect(gl.deleteShader).not.toHaveBeenCalled();

    gl.getProgramParameter.mockReturnValue(true);
    expect(pending.poll()).toBe(program);
    expect(gl.getProgramParameter.mock.calls.slice(-2)).toEqual([
      [program, completionStatus],
      [program, gl.LINK_STATUS]
    ]);
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(gl.detachShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).not.toHaveBeenCalled();

    gl.getProgramParameter.mockClear();
    expect(pending.poll()).toBe(program);
    expect(gl.getProgramParameter).not.toHaveBeenCalled();
    pending.dispose();
    pending.dispose();
    expect(gl.deleteProgram.mock.calls).toEqual([[program]]);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(() => pending.poll()).toThrow('disposed');
  });

  it('checks link status on the first poll when parallel compilation is unavailable', () => {
    const { gl, program } = createHarness({ parallel: false });
    const pending = createPendingProgram(gl, 'vertex', 'fragment');

    expect(gl.getProgramParameter).not.toHaveBeenCalled();
    expect(pending.poll()).toBe(program);
    expect(gl.getProgramParameter.mock.calls).toEqual([[program, gl.LINK_STATUS]]);
  });

  it('can dispose an unfinished program without waiting or querying shader status', () => {
    const { gl, program } = createHarness();
    const pending = createPendingProgram(gl, 'vertex', 'fragment');
    pending.dispose();
    pending.dispose();

    expect(gl.deleteProgram.mock.calls).toEqual([[program]]);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.getProgramParameter).not.toHaveBeenCalled();
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(() => pending.poll()).toThrow('disposed');
  });

  it('reports stage and link failures only after completion and releases resources once', () => {
    const { gl, program, completionStatus, vertexShader } = createHarness();
    const pending = createPendingProgram(gl, 'bad vertex', 'fragment');
    gl.getProgramParameter.mockImplementation((_program, parameter) => parameter === completionStatus);
    gl.getShaderParameter.mockImplementation((shader) => shader !== vertexShader);
    gl.getShaderInfoLog.mockReturnValue('syntax error at line 7');
    gl.getProgramInfoLog.mockReturnValue('vertex compilation failed');

    expect(() => pending.poll()).toThrow('Vertex shader compile failed: syntax error at line 7');
    expect(() => pending.poll()).toThrow('Shader link failed: vertex compilation failed');
    expect(gl.getProgramParameter).toHaveBeenCalledTimes(2);
    expect(gl.getShaderInfoLog.mock.calls).toEqual([[vertexShader]]);
    pending.dispose();
    expect(gl.deleteProgram.mock.calls).toEqual([[program]]);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('reports a link error when both shader stages compiled successfully', () => {
    const { gl, completionStatus } = createHarness();
    const pending = createPendingProgram(gl, 'vertex', 'fragment');
    gl.getProgramParameter.mockImplementation((_program, parameter) => parameter === completionStatus);
    gl.getProgramInfoLog.mockReturnValue('varyings do not match');

    expect(() => pending.poll()).toThrow('Shader link failed: varyings do not match');
    expect(gl.getShaderInfoLog).not.toHaveBeenCalled();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('releases the first shader if creating the second shader fails', () => {
    const { gl, vertexShader } = createHarness();
    gl.createShader.mockReturnValueOnce(vertexShader).mockReturnValueOnce(null);

    expect(() => createPendingProgram(gl, 'vertex', 'fragment')).toThrow('Unable to create fragment shader');
    expect(gl.deleteShader.mock.calls).toEqual([[vertexShader]]);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it('releases both shaders if creating a program fails', () => {
    const { gl } = createHarness();
    gl.createProgram.mockReturnValue(null);

    expect(() => createPendingProgram(gl, 'vertex', 'fragment')).toThrow('Unable to create shader program');
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });
});

function createHarness({ parallel = true }: { parallel?: boolean } = {}) {
  const vertexShader = { stage: 'vertex' } as unknown as WebGLShader;
  const fragmentShader = { stage: 'fragment' } as unknown as WebGLShader;
  const program = {} as WebGLProgram;
  const completionStatus = 0x91b1;
  const mock = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    getExtension: vi.fn(() => parallel ? { COMPLETION_STATUS_KHR: completionStatus } : null),
    createShader: vi.fn<(type: number) => WebGLShader | null>((type) => type === 0x8b31 ? vertexShader : fragmentShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    createProgram: vi.fn<() => WebGLProgram | null>(() => program),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_program: WebGLProgram, parameter: number): boolean => parameter !== completionStatus),
    getShaderParameter: vi.fn((_shader: WebGLShader, _parameter: number): boolean => true),
    getProgramInfoLog: vi.fn<() => string | null>(() => null),
    getShaderInfoLog: vi.fn<() => string | null>(() => null),
    detachShader: vi.fn(),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn()
  };
  // Retain the mock signatures alongside the WebGL type for expectations.
  const gl = mock as typeof mock & WebGL2RenderingContext;
  return { gl, program, completionStatus, vertexShader, fragmentShader };
}
