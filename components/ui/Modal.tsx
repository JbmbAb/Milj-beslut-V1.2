import React, { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * Modal component with backdrop and animations
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`bg-white rounded-2xl shadow-xl w-full ${sizeClasses[size]} ${className}`}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <h2 className="text-xl font-black text-slate-900">{title}</h2>
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="Close modal"
                >
                  <i className="fas fa-times text-lg" />
                </button>
              </div>

              <div className="p-6 max-h-[60vh] overflow-y-auto">{children}</div>

              {footer && (
                <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3 bg-slate-50 rounded-b-2xl">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default Modal;
