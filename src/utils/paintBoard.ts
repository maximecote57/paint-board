import { cloneDeep } from 'lodash'
import { ElementRect, ELEMENT_INSTANCE, MousePosition } from '@/types'
import { CleanLine, cleanLineRender } from './element/cleanLine'
import {
  FreeLine,
  FreeLineRect,
  freeLineRender,
  resizeFreeLine,
  moveFreeLine
} from './element/freeLine'
import { CANVAS_ELE_TYPE, CommonWidth, RESIZE_TYPE } from './constants'
import { EACH_ORDER_TYPE, History } from './history'
import { BOARD_STORAGE_KEY, storage } from './storage'
import { Layer } from './layer'
import {
  drawResizeRect,
  getPositionToLineDistance,
  getResizeType,
  getDistance,
  isInsideRect
} from './common'
import { Cursor, CURSOR_TYPE, getResizeCursorType } from './cursor'
import { resizeTextElement, TextElement, textRender } from './element/text'

type MOVE_ELE = FreeLine | CleanLine | null

/**
 * PaintBoard
 */
export class PaintBoard {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  // 历史操作记录
  history: History<ELEMENT_INSTANCE>
  // 原点位置
  originPosition = {
    x: 0,
    y: 0
  }
  // 针对原点拖拽距离
  originTranslate = {
    x: 0,
    y: 0
  }
  // canvas几何属性
  canvasRect = {
    top: 0,
    left: 0
  }
  // 图层
  layer: Layer
  // 鼠标样式
  cursor: Cursor
  version = '0.2.0' // 版本号，主要用于兼容缓存数据

  constructor(canvas: HTMLCanvasElement) {
    // 初始化配置
    this.canvas = canvas
    this.context = canvas.getContext('2d') as CanvasRenderingContext2D
    this.initCanvasSize()
    this.initOriginPosition()
    const { top, left } = canvas.getBoundingClientRect()
    this.canvasRect = {
      top,
      left
    }
    this.cursor = new Cursor(canvas)

    // 获取缓存
    const { history = [], state = {} } = storage.get(BOARD_STORAGE_KEY) || {}
    Object.assign(this, { ...state })

    // 初始化缓存数据
    this.layer = new Layer(this.render.bind(this), state?.layer)

    // 兼容一下v0.1.0时未记录版本的问题
    const version = state?.version ? state.version : '0.1.0'
    this.history = new History(history, version)

    this.context.translate(this.originTranslate.x, this.originTranslate.y)
    this.render()
  }

  /**
   * 初始化canvas宽高
   */
  initCanvasSize() {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  /**
   * 初始化原点
   */
  initOriginPosition() {
    this.context.translate(0, 0)
    this.originPosition = {
      x: 0,
      y: 0
    }
  }

  // 记录当前移动元素，用于画笔和橡皮擦
  currentMoveEle: MOVE_ELE = null

  /**
   * 记录当前移动元素，并加入history
   */
  recordCurrent(type: string) {
    let ele: MOVE_ELE = null
    switch (type) {
      case CANVAS_ELE_TYPE.FREE_LINE:
        ele = new FreeLine(
          this.currentLineColor,
          this.currentLineWidth,
          this.layer.current
        )
        break
      case CANVAS_ELE_TYPE.CLEAN_LINE:
        ele = new CleanLine(this.cleanWidth, this.layer.current)
        break
      default:
        break
    }
    this.cancelSelectElement()
    if (ele) {
      this.history.add(ele)
      this.currentMoveEle = ele
      this.sortOnLayer()
    }
  }

  /**
   * 对history进行排序
   */
  sortOnLayer() {
    this.history.sort((a, b) => {
      return (
        this.layer.stack.findIndex(({ id }) => id === b?.layer) -
        this.layer.stack.findIndex(({ id }) => id === a?.layer)
      )
    })
  }

  /**
   * 为当前移动元素添加坐标数据
   */
  currentAddPosition(position: MousePosition) {
    this.currentMoveEle?.addPosition({
      x: position.x - this.canvasRect.left - this.originTranslate.x,
      y: position.y - this.canvasRect.top - this.originTranslate.y
    })
    this.initOriginPosition()
    this.render()
  }

  /**
   * 拖拽画布
   */
  dragCanvas(position: MousePosition) {
    const mousePosition = {
      x: position.x - this.canvasRect.left,
      y: position.y - this.canvasRect.top
    }
    this.cursor.change(CURSOR_TYPE.POINTER)
    if (this.originPosition.x && this.originPosition.y) {
      const translteX = mousePosition.x - this.originPosition.x
      const translteY = mousePosition.y - this.originPosition.y
      this.context.translate(translteX, translteY)
      this.originTranslate = {
        x: translteX + this.originTranslate.x,
        y: translteY + this.originTranslate.y
      }
      this.render()
    }
    this.originPosition = mousePosition
  }

  /**
   * 遍历history渲染数据
   */
  render() {
    this.cleanCanvas()
    if (this.history.getCurrentStack()?.length ?? 0 > 0) {
      const showLayerIds = new Set(
        this.layer.stack.reduce<number[]>((acc, cur) => {
          return cur.show ? [...acc, cur.id] : acc
        }, [])
      )
      this.history.each((ele) => {
        if (ele?.layer && showLayerIds.has(ele.layer)) {
          this.context.save()
          switch (ele?.type) {
            case CANVAS_ELE_TYPE.FREE_LINE:
              freeLineRender(this.context, ele as FreeLine)
              break
            case CANVAS_ELE_TYPE.CLEAN_LINE:
              cleanLineRender(
                this.context,
                this.cleanCanvas.bind(this),
                ele as CleanLine
              )
              break
            case CANVAS_ELE_TYPE.TEXT:
              textRender(this.context, ele as TextElement)
              break
            default:
              break
          }
          this.context.restore()
        }
      })

      if (this.selectElementIndex !== -1) {
        const rect = this.getSelectElement(this.selectElementIndex).rect
        drawResizeRect(this.context, rect)
      }
    }
    this.cache()
  }

  /**
   * localStorage 缓存
   */
  cache() {
    const history = this.history.getCurrentStack()
    const {
      currentLineColor,
      currentLineWidth,
      cleanWidth,
      originTranslate,
      layer,
      version
    } = this
    const state = {
      currentLineColor,
      currentLineWidth,
      cleanWidth,
      originTranslate,
      layer,
      version
    }
    storage.set(BOARD_STORAGE_KEY, { history, state })
  }

  /**
   * 清除画布
   */
  cleanCanvas(w = Number.MAX_SAFE_INTEGER) {
    this.context.clearRect(-(w / 2), -(w / 2), w, w)
  }

  // 当前绘线颜色
  currentLineColor = '#000000'
  // 当前绘线宽
  currentLineWidth = CommonWidth.W4

  /**
   * 修改绘线宽
   * @param width 绘线宽
   */
  setLineWidth(width: number) {
    if (width) {
      this.currentLineWidth = width
    }
  }

  /**
   * 修改绘线颜色
   * @param color 绘线颜色
   */
  setLineColor(color: string) {
    if (color) {
      this.currentLineColor = color
    }
  }

  // 当前橡皮擦宽度
  cleanWidth = CommonWidth.W4

  /**
   * 修改橡皮擦宽度
   * @param width 橡皮擦宽度
   */
  setCleanWidth(width: number) {
    if (width) {
      this.cleanWidth = width
    }
  }

  /**
   * 后退
   */
  undo() {
    this.cancelSelectElement()
    this.history.undo()
    this.render()
  }

  /**
   * 前进
   */
  redo() {
    this.cancelSelectElement()
    this.history.redo()
    this.render()
  }

  /**
   * 清除画布
   */
  clean() {
    this.cancelSelectElement()
    this.history.clean()
    this.render()
  }

  /**
   * 保存为图片
   */
  saveImage() {
    const imageUrl = this.canvas.toDataURL('image/png')
    const elink = document.createElement('a')
    elink.download = 'image'
    elink.style.display = 'none'
    elink.href = imageUrl
    document.body.appendChild(elink)
    elink.click()
    URL.revokeObjectURL(elink.href)
    document.body.removeChild(elink)
    this.context.translate(this.originTranslate.x, this.originTranslate.y)
  }

  /**
   * 转换坐标
   */
  transformPosition(position: MousePosition) {
    return {
      x: position.x - this.canvasRect.left - this.originTranslate.x,
      y: position.y - this.canvasRect.top - this.originTranslate.y
    }
  }

  mouseHoverElementIndex = -1 // 选择模式下鼠标悬停元素坐标
  selectElementIndex = -1 // 选择模式下当前选择元素坐标
  resizeMousePos = {
    x: 0,
    y: 0
  } // 调整大小鼠标位置
  resizeType = RESIZE_TYPE.NULL // 调整大小鼠标点击类型
  tempCache: ELEMENT_INSTANCE[] | null = null // 临时缓存
  isCurrentChange = false // 当前是否有变化

  /**
   * 选择模式下 移动鼠标
   * @param position
   */
  moveSelectElement(position: MousePosition) {
    const movePos = this.transformPosition(position)
    let cursorType = CURSOR_TYPE.AUTO

    /**
     * 遍历符合条件的所有元素，判断鼠标是否悬浮到元素上方
     */
    if (this.history.getCurrentStack()?.length ?? 0 > 0) {
      const showLayerIds = new Set(
        this.layer.stack.reduce<number[]>((acc, cur) => {
          return cur.show ? [...acc, cur.id] : acc
        }, [])
      )
      let done = false // 判断是否找到元素
      this.history.each((ele, eleIndex) => {
        if (ele?.layer && showLayerIds.has(ele.layer)) {
          if (done) {
            return
          }
          let positions = []
          switch (ele.type) {
            case CANVAS_ELE_TYPE.FREE_LINE:
              positions = (ele as FreeLine).positions
              for (let i = 1; i < positions.length; i++) {
                const distance1 = getDistance(movePos, positions[i - 1])
                const distance2 = getDistance(movePos, positions[i])
                const distance = getPositionToLineDistance(
                  movePos,
                  positions[i - 1],
                  positions[i]
                )
                if ((distance1 < 10 || distance2 < 10) && distance < 10) {
                  this.mouseHoverElementIndex = eleIndex
                  cursorType = CURSOR_TYPE.POINTER
                  done = true
                }
              }
              break
            case CANVAS_ELE_TYPE.TEXT:
              if (isInsideRect(movePos, (ele as TextElement).rect)) {
                this.mouseHoverElementIndex = eleIndex
                cursorType = CURSOR_TYPE.POINTER
                done = true
              }
              break
            default:
              break
          }
        }
      }, EACH_ORDER_TYPE.LAST)
      if (!done) {
        this.mouseHoverElementIndex = -1
      }
    }
    if (this.selectElementIndex !== -1) {
      if (this.resizeType !== RESIZE_TYPE.NULL) {
        this.isCurrentChange = true
        const { x, y } = movePos
        const resizeElement = this.getSelectElement(this.selectElementIndex)
        const disntanceX = x - this.resizeMousePos.x
        const disntanceY = y - this.resizeMousePos.y
        cursorType = getResizeCursorType(this.resizeType, cursorType)
        if (resizeElement.type === CANVAS_ELE_TYPE.FREE_LINE) {
          const rect = { ...resizeElement.rect } as FreeLineRect
          switch (this.resizeType) {
            case RESIZE_TYPE.BODY:
              moveFreeLine(resizeElement as FreeLine, disntanceX, disntanceY)
              break
            case RESIZE_TYPE.BOTTOM_RIGHT:
              resizeFreeLine(
                resizeElement as FreeLine,
                (rect.width + disntanceX) / rect.width,
                (rect.height + disntanceY) / rect.height,
                rect,
                RESIZE_TYPE.BOTTOM_RIGHT
              )
              break
            case RESIZE_TYPE.BOTTOM_LEFT:
              resizeFreeLine(
                resizeElement as FreeLine,
                (rect.width - disntanceX) / rect.width,
                (rect.height + disntanceY) / rect.height,
                rect,
                RESIZE_TYPE.BOTTOM_LEFT
              )
              break
            case RESIZE_TYPE.TOP_LEFT:
              resizeFreeLine(
                resizeElement as FreeLine,
                (rect.width - disntanceX) / rect.width,
                (rect.height - disntanceY) / rect.height,
                rect,
                RESIZE_TYPE.TOP_LEFT
              )
              break
            case RESIZE_TYPE.TOP_RIGHT:
              resizeFreeLine(
                resizeElement as FreeLine,
                (rect.width + disntanceX) / rect.width,
                (rect.height - disntanceY) / rect.height,
                rect,
                RESIZE_TYPE.TOP_RIGHT
              )
              break
            default:
              break
          }
        } else if (resizeElement.type === CANVAS_ELE_TYPE.TEXT) {
          switch (this.resizeType) {
            case RESIZE_TYPE.BODY:
              resizeElement.rect.x += disntanceX
              resizeElement.rect.y += disntanceY
              break
            case RESIZE_TYPE.BOTTOM_RIGHT:
              resizeTextElement(
                resizeElement as TextElement,
                resizeElement.rect.width + disntanceX,
                resizeElement.rect.height + disntanceY,
                RESIZE_TYPE.BOTTOM_RIGHT
              )
              break
            case RESIZE_TYPE.BOTTOM_LEFT:
              resizeTextElement(
                resizeElement as TextElement,
                resizeElement.rect.width - disntanceX,
                resizeElement.rect.height + disntanceY,
                RESIZE_TYPE.BOTTOM_LEFT
              )
              break
            case RESIZE_TYPE.TOP_LEFT:
              resizeTextElement(
                resizeElement as TextElement,
                resizeElement.rect.width - disntanceX,
                resizeElement.rect.height - disntanceY,
                RESIZE_TYPE.TOP_LEFT
              )
              break
            case RESIZE_TYPE.TOP_RIGHT:
              resizeTextElement(
                resizeElement as TextElement,
                resizeElement.rect.width + disntanceX,
                resizeElement.rect.height - disntanceY,
                RESIZE_TYPE.TOP_RIGHT
              )
              break
            default:
              break
          }
        }

        this.resizeMousePos = movePos
        this.render()
      } else {
        const resizeType = getResizeType(
          movePos,
          this.getSelectElement(this.selectElementIndex).rect
        )
        cursorType = getResizeCursorType(resizeType, cursorType)
      }
    }
    this.cursor.change(cursorType)
  }

  /**
   * 鼠标点击获取选择元素
   * @param position
   */
  clickSelectElement(position: MousePosition) {
    const resizeMousePos = this.transformPosition(position)
    if (this.selectElementIndex !== -1) {
      const resizeType = getResizeType(
        resizeMousePos,
        this.getSelectElement(this.selectElementIndex).rect
      )
      this.resizeType = resizeType
    }
    if (this.resizeType === RESIZE_TYPE.NULL) {
      if (this.mouseHoverElementIndex !== -1) {
        this.cursor.change(CURSOR_TYPE.MOVE)
        this.selectElementIndex = this.mouseHoverElementIndex
      } else {
        this.cancelSelectElement()
      }
    }
    if (this.selectElementIndex !== -1) {
      this.tempCache = cloneDeep(this.history.getCurrentStack())
      this.resizeMousePos = resizeMousePos
    }

    this.render()
  }

  /**
   * 获取当前选择元素
   * @param index 坐标
   */
  getSelectElement(index: number) {
    const last = this.history.getCurrentStack() as ELEMENT_INSTANCE[]
    return last[index] as FreeLine | TextElement
  }

  /**
   * 删除当前选择元素
   */
  deleteSelectElement() {
    if (this.selectElementIndex !== -1) {
      this.history.deleteByIndex(this.selectElementIndex)
      this.cancelSelectElement()
      this.mouseHoverElementIndex = -1
      this.resizeType = RESIZE_TYPE.NULL
      this.render()
    }
  }

  /**
   * 取消选择元素
   */
  cancelSelectElement() {
    this.selectElementIndex = -1
  }

  /**
   * 鼠标松开
   */
  canvasMouseUp() {
    if (this.isCurrentChange && this.tempCache) {
      this.history.pushStack(this.history.getCurrentStack(), this.tempCache)
    }
    this.isCurrentChange = false
    this.tempCache = null
    this.resizeType = RESIZE_TYPE.NULL
    this.currentMoveEle = null
    this.initOriginPosition()
  }

  /**
   * 添加文本元素
   * @param value 文本内容
   * @param rect 文本矩形属性
   */
  addTextElement(value: string, rect: ElementRect) {
    if (value) {
      const position = this.transformPosition(rect)
      rect.x = position.x
      rect.y = position.y
      const text = new TextElement(this.layer.current, value, rect)
      this.history.add(text)
      this.render()
    }
  }
}
